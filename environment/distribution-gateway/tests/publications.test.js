'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { buildApp } = require('../app');
const { PublicationLedger } = require('../lib/publication-store');

// --- key material ------------------------------------------------------------
// The build-time keys are absent in the authoring/test sandbox, so the suite
// mints ephemeral self-signed current + revoked keypairs and redirects the
// gateway at the current one through CURRENT_CERT_PATH.
const keyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-keys-'));
const currentCert = path.join(keyHome, 'current.cert.pem');
const currentKey = path.join(keyHome, 'current.key.pem');
const revokedCert = path.join(keyHome, 'revoked.cert.pem');
const revokedKey = path.join(keyHome, 'revoked.key.pem');

function mintKeypair(certPath, keyPath, cn) {
  const r = spawnSync(
    'openssl',
    [
      'req', '-x509', '-newkey', 'rsa:2048',
      '-keyout', keyPath, '-out', certPath,
      '-days', '3650', '-nodes', '-subj', `/CN=${cn}`,
    ],
    { encoding: 'utf8' }
  );
  assert.equal(r.status, 0, `openssl req failed for ${cn}: ${r.stderr}`);
}

mintKeypair(currentCert, currentKey, 'fw-current');
mintKeypair(revokedCert, revokedKey, 'fw-revoked');
process.env.CURRENT_CERT_PATH = currentCert;

// Canonical release descriptor: UTF-8 JSON, sorted keys, no insignificant space.
const canonicalDescriptor = JSON.stringify({
  artifact_count: 3,
  bundle_id: 'BND-900',
  total_bytes: 148096,
});

// Detached CMS signature (PEM) over the exact canonical bytes.
function signDetached(certPath, keyPath, payload) {
  const contentFile = path.join(keyHome, `content-${Math.random().toString(36).slice(2)}.bin`);
  fs.writeFileSync(contentFile, payload, 'utf8');
  const r = spawnSync(
    'openssl',
    [
      'cms', '-sign', '-in', contentFile,
      '-signer', certPath, '-inkey', keyPath,
      '-outform', 'PEM', '-binary',
    ],
    { encoding: 'utf8' }
  );
  fs.rmSync(contentFile, { force: true });
  assert.equal(r.status, 0, `openssl cms -sign failed: ${r.stderr}`);
  return r.stdout;
}

const currentSignature = signDetached(currentCert, currentKey, canonicalDescriptor);
const revokedSignature = signDetached(revokedCert, revokedKey, canonicalDescriptor);

// --- server harness ----------------------------------------------------------
// Each test gets a fresh in-process app on an ephemeral port and its own ledger.
function startGateway() {
  const ledgerFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fw-ledger-')), 'ledger.json');
  const ledger = new PublicationLedger(ledgerFile);
  const app = buildApp({ ledger });
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        base: `http://127.0.0.1:${port}`,
        ledger,
        close: () => new Promise((res) => server.close(res)),
      });
    });
  });
}

// Acceptance 1: GET /v1/signing-key/current -> 200 with key id + algorithm.
test('GET /v1/signing-key/current returns current key metadata', async () => {
  const gw = await startGateway();
  try {
    const res = await fetch(`${gw.base}/v1/signing-key/current`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(typeof body.key_id, 'string');
    assert.ok(body.key_id.length > 0);
    assert.equal(typeof body.algorithm, 'string');
    assert.ok(body.algorithm.length > 0);
    assert.equal(body.status, 'current');
  } finally {
    await gw.close();
  }
});

// Acceptance 2: current-signed POST -> receipt {publication_id, request_token, PUBLISHED}.
test('POST /v1/publications accepts a descriptor signed by the current key', async () => {
  const gw = await startGateway();
  try {
    const res = await fetch(`${gw.base}/v1/publications`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        descriptor: canonicalDescriptor,
        signature: currentSignature,
        request_token: 'token-accept-1',
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(typeof body.publication_id, 'string');
    assert.ok(body.publication_id.length > 0);
    assert.equal(body.request_token, 'token-accept-1');
    assert.equal(body.status, 'PUBLISHED');
    assert.equal(gw.ledger.size(), 1);
  } finally {
    await gw.close();
  }
});

// Acceptance 3: revoked-signed POST -> UNTRUSTED_SIGNATURE, nothing recorded.
test('POST /v1/publications rejects a descriptor signed by the revoked key', async () => {
  const gw = await startGateway();
  try {
    const res = await fetch(`${gw.base}/v1/publications`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        descriptor: canonicalDescriptor,
        signature: revokedSignature,
        request_token: 'token-revoked-1',
      }),
    });
    assert.notEqual(res.status, 200);
    const body = await res.json();
    assert.equal(body.error, 'UNTRUSTED_SIGNATURE');
    assert.equal(gw.ledger.size(), 0);
  } finally {
    await gw.close();
  }
});

// Acceptance 4: repeated request token -> original receipt, no duplicate row.
test('POST /v1/publications is idempotent for a repeated request token', async () => {
  const gw = await startGateway();
  try {
    const payload = {
      descriptor: canonicalDescriptor,
      signature: currentSignature,
      request_token: 'token-replay-1',
    };
    const first = await fetch(`${gw.base}/v1/publications`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(first.status, 200);
    const firstReceipt = await first.json();

    const second = await fetch(`${gw.base}/v1/publications`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(second.status, 200);
    const secondReceipt = await second.json();

    assert.deepEqual(secondReceipt, firstReceipt);
    assert.equal(gw.ledger.size(), 1);
  } finally {
    await gw.close();
  }
});

// Acceptance 5: the entrypoint boots and serves on a bound port.
test('the app boots and serves HTTP on a bound port', async () => {
  const gw = await startGateway();
  try {
    const res = await fetch(`${gw.base}/healthz`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
  } finally {
    await gw.close();
  }
});

test.after(() => {
  fs.rmSync(keyHome, { recursive: true, force: true });
});
