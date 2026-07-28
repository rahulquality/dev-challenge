'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const { currentCertPath } = require('./config');

// Verifies a detached CMS signature over the exact descriptor bytes the client
// uploaded, against the CURRENT signing certificate. The current certificate is a
// self-signed X.509, so it is simultaneously the source of the signer certificate
// (-certfile) and the trust root (-CAfile). A descriptor signed with the revoked
// key does not chain to the current certificate: openssl exits non-zero and the
// caller is told the signature is untrusted.
//
// The descriptor bytes and the PEM signature are staged in a short-lived temp
// directory so the openssl CLI can read them; the directory is always removed.
function verifyDetachedSignature(descriptorBytes, signaturePem) {
  const certPath = currentCertPath();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sigcheck-'));
  const descriptorFile = path.join(scratch, 'descriptor.bin');
  const signatureFile = path.join(scratch, 'sig.pem');

  try {
    fs.writeFileSync(descriptorFile, descriptorBytes);
    fs.writeFileSync(signatureFile, signaturePem);

    try {
      execFileSync(
        'openssl',
        [
          'cms',
          '-verify',
          '-inform', 'PEM',
          '-in', signatureFile,
          '-content', descriptorFile,
          '-certfile', certPath,
          '-CAfile', certPath,
          '-purpose', 'any',
          '-no_check_time',
          '-binary',
        ],
        { stdio: ['ignore', 'ignore', 'pipe'] }
      );
      return { trusted: true };
    } catch (err) {
      // Non-zero exit (bad signature) or openssl not spawnable.
      const detail = err.stderr ? err.stderr.toString().trim() : err.message;
      return { trusted: false, detail };
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

// Deterministic canonical encoding the signer and the gateway agree on: UTF-8
// JSON, object keys sorted lexicographically, no insignificant whitespace. Used
// only when a caller uploads the descriptor as a structured object; a descriptor
// supplied as a raw string is verified as the exact bytes received.
function canonicalEncode(value) {
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalEncode).join(',') + ']';
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.keys(value)
      .sort()
      .map((k) => JSON.stringify(k) + ':' + canonicalEncode(value[k]));
    return '{' + entries.join(',') + '}';
  }
  return JSON.stringify(value);
}

// Convenience digest helper for callers that want a content fingerprint; the
// verify path does not use it (it operates on the exact received bytes).
function sha256Hex(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

module.exports = { verifyDetachedSignature, canonicalEncode, sha256Hex };
