import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import duckdb from 'duckdb';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH =
  process.env.BUILD_MANIFEST_PATH || path.join(APP_ROOT, 'fixtures', 'build_manifest.csv');
const DATABASE_PATH =
  process.env.RELEASES_DATABASE_PATH || path.join(APP_ROOT, 'releases.duckdb');
const GATEWAY_URL = (process.env.DISTRIBUTION_GATEWAY_URL || 'http://127.0.0.1:7070')
  .replace(/\/+$/, '');

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function openDatabase(file) {
  return new Promise((resolve, reject) => {
    const database = new duckdb.Database(file, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve(database);
      }
    });
  });
}

function run(database, statement, parameters = []) {
  return new Promise((resolve, reject) => {
    database.run(statement, ...parameters, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

function all(database, statement, parameters = []) {
  return new Promise((resolve, reject) => {
    database.all(statement, ...parameters, (error, rows) => {
      if (error) {
        reject(error);
      } else {
        resolve(rows);
      }
    });
  });
}

function closeDatabase(database) {
  return new Promise((resolve, reject) => {
    database.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

function canonicalEncode(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalEncode).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalEncode(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

async function readJson(response, context) {
  const body = await response.text();
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`${context} returned a non-JSON response (HTTP ${response.status})`);
  }
}

async function fetchCurrentSigningKey() {
  let response;
  try {
    response = await fetch(`${GATEWAY_URL}/v1/signing-key/current`, {
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new Error(`Unable to read current signing-key metadata: ${error.message}`);
  }

  const metadata = await readJson(response, 'Signing-key endpoint');
  if (!response.ok) {
    throw new Error(
      `Signing-key endpoint failed with HTTP ${response.status}: ${
        metadata.error || metadata.message || 'unknown error'
      }`,
    );
  }
  if (
    typeof metadata.key_id !== 'string' ||
    metadata.key_id.length === 0 ||
    typeof metadata.certificate_ref !== 'string' ||
    metadata.certificate_ref.length === 0 ||
    metadata.status !== 'current'
  ) {
    throw new Error('Signing-key endpoint did not return a usable current key');
  }
  if (metadata.algorithm !== 'sha256WithRSAEncryption') {
    throw new Error(`Unsupported signing algorithm: ${metadata.algorithm}`);
  }
  return metadata;
}

function resolveContainerPath(file) {
  if (existsSync(file)) {
    return file;
  }
  if (file === '/app') {
    return APP_ROOT;
  }
  if (file.startsWith('/app/')) {
    return path.join(APP_ROOT, file.slice('/app/'.length));
  }
  return file;
}

function signingPaths(metadata) {
  const certificatePath = resolveContainerPath(
    process.env.CURRENT_SIGNING_CERT_PATH || metadata.certificate_ref,
  );
  const inferredKeyPath = certificatePath.endsWith('.cert.pem')
    ? certificatePath.replace(/\.cert\.pem$/, '.key.pem')
    : path.join(path.dirname(certificatePath), 'current.key.pem');
  const privateKeyPath =
    process.env.CURRENT_SIGNING_KEY_PATH || inferredKeyPath;

  if (!existsSync(certificatePath)) {
    throw new Error(`Current signing certificate not found: ${certificatePath}`);
  }
  if (!existsSync(privateKeyPath)) {
    throw new Error(`Current signing private key not found: ${privateKeyPath}`);
  }
  return { certificatePath, privateKeyPath };
}

function signDescriptor(descriptor, certificatePath, privateKeyPath) {
  const scratch = mkdtempSync(path.join(tmpdir(), 'release-sign-'));
  const descriptorPath = path.join(scratch, 'descriptor.bin');
  try {
    writeFileSync(descriptorPath, descriptor, 'utf8');
    const result = spawnSync(
      'openssl',
      [
        'cms',
        '-sign',
        '-in',
        descriptorPath,
        '-signer',
        certificatePath,
        '-inkey',
        privateKeyPath,
        '-outform',
        'PEM',
        '-binary',
        '-md',
        'sha256',
      ],
      {
        encoding: 'utf8',
        maxBuffer: 2 * 1024 * 1024,
      },
    );

    if (result.error) {
      throw new Error(`Unable to start OpenSSL: ${result.error.message}`);
    }
    if (result.status !== 0 || !result.stdout) {
      throw new Error(
        `OpenSSL failed to sign the release descriptor: ${
          result.stderr.trim() || `exit status ${result.status}`
        }`,
      );
    }
    return result.stdout;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

async function submitPublication(descriptor, signature, requestToken) {
  let response;
  try {
    response = await fetch(`${GATEWAY_URL}/v1/publications`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        descriptor,
        signature,
        request_token: requestToken,
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new Error(`Unable to submit ${requestToken}: ${error.message}`);
  }

  const receipt = await readJson(response, 'Publication endpoint');
  if (!response.ok) {
    throw new Error(
      `Publication ${requestToken} failed with HTTP ${response.status}: ${
        receipt.error || receipt.message || 'unknown error'
      }`,
    );
  }
  if (
    typeof receipt.publication_id !== 'string' ||
    receipt.publication_id.length === 0 ||
    receipt.request_token !== requestToken ||
    receipt.status !== 'PUBLISHED'
  ) {
    throw new Error(`Publication ${requestToken} returned an invalid receipt`);
  }
  return receipt;
}

async function initializeDatabase(database) {
  await run(
    database,
    `
      CREATE OR REPLACE TABLE build_manifest AS
      SELECT
        entry_id::VARCHAR AS entry_id,
        bundle_id::VARCHAR AS bundle_id,
        component_id::VARCHAR AS component_id,
        version::VARCHAR AS version,
        size_bytes::BIGINT AS size_bytes,
        record_type::VARCHAR AS record_type,
        supersedes_id::VARCHAR AS supersedes_id,
        recorded_at::VARCHAR AS recorded_at
      FROM read_csv_auto(
        ${sqlString(MANIFEST_PATH)},
        header = true,
        all_varchar = true
      )
    `,
  );

  await run(
    database,
    `
      CREATE TABLE IF NOT EXISTS publications (
        bundle_id VARCHAR PRIMARY KEY,
        artifact_count BIGINT NOT NULL,
        total_bytes BIGINT NOT NULL,
        descriptor VARCHAR NOT NULL,
        key_id VARCHAR NOT NULL,
        request_token VARCHAR NOT NULL UNIQUE,
        publication_id VARCHAR NOT NULL,
        status VARCHAR NOT NULL,
        retry_state VARCHAR NOT NULL
      )
    `,
  );
}

async function publishableBundles(database) {
  return all(
    database,
    `
      WITH distinct_entries AS (
        SELECT DISTINCT
          entry_id,
          bundle_id,
          component_id,
          version,
          size_bytes,
          record_type,
          supersedes_id,
          recorded_at
        FROM build_manifest
      ),
      withdrawn_entries AS (
        SELECT DISTINCT supersedes_id AS entry_id
        FROM distinct_entries
        WHERE record_type = 'WITHDRAWAL'
          AND supersedes_id IS NOT NULL
          AND supersedes_id <> ''
      ),
      surviving_builds AS (
        SELECT builds.*
        FROM distinct_entries AS builds
        LEFT JOIN withdrawn_entries
          ON withdrawn_entries.entry_id = builds.entry_id
        WHERE builds.record_type = 'BUILD'
          AND withdrawn_entries.entry_id IS NULL
      )
      SELECT
        bundle_id,
        count(*)::BIGINT AS artifact_count,
        sum(size_bytes)::BIGINT AS total_bytes
      FROM surviving_builds
      GROUP BY bundle_id
      HAVING count(*) > 0
      ORDER BY bundle_id
    `,
  );
}

async function storedPublication(database, bundleId) {
  const rows = await all(
    database,
    `
      SELECT
        bundle_id,
        artifact_count,
        total_bytes,
        descriptor,
        key_id,
        request_token,
        publication_id,
        status,
        retry_state
      FROM publications
      WHERE bundle_id = ?
    `,
    [bundleId],
  );
  return rows[0] || null;
}

function assertStoredPublicationMatches(row, descriptor, requestToken) {
  if (
    row.descriptor !== descriptor ||
    row.request_token !== requestToken ||
    row.status !== 'PUBLISHED' ||
    row.retry_state !== 'COMPLETE'
  ) {
    throw new Error(
      `Stored publication state for ${row.bundle_id} conflicts with the current manifest`,
    );
  }
}

async function persistReceipt(
  database,
  bundle,
  descriptor,
  keyId,
  requestToken,
  receipt,
) {
  await run(
    database,
    `
      INSERT INTO publications (
        bundle_id,
        artifact_count,
        total_bytes,
        descriptor,
        key_id,
        request_token,
        publication_id,
        status,
        retry_state
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETE')
    `,
    [
      bundle.bundle_id,
      bundle.artifact_count,
      bundle.total_bytes,
      descriptor,
      keyId,
      requestToken,
      receipt.publication_id,
      receipt.status,
    ],
  );
}

async function createReport() {
  if (!existsSync(MANIFEST_PATH)) {
    throw new Error(`Build manifest not found: ${MANIFEST_PATH}`);
  }

  const metadata = await fetchCurrentSigningKey();
  const { certificatePath, privateKeyPath } = signingPaths(metadata);
  const database = await openDatabase(DATABASE_PATH);
  const lines = [];

  try {
    await initializeDatabase(database);
    const bundles = await publishableBundles(database);

    for (const rawBundle of bundles) {
      const bundle = {
        bundle_id: rawBundle.bundle_id,
        artifact_count: Number(rawBundle.artifact_count),
        total_bytes: Number(rawBundle.total_bytes),
      };
      const descriptor = canonicalEncode({
        artifact_count: bundle.artifact_count,
        bundle_id: bundle.bundle_id,
        total_bytes: bundle.total_bytes,
      });
      const requestToken = `token-${bundle.bundle_id}`;
      const saved = await storedPublication(database, bundle.bundle_id);

      let receipt;
      if (saved) {
        assertStoredPublicationMatches(saved, descriptor, requestToken);
        receipt = {
          publication_id: saved.publication_id,
          request_token: saved.request_token,
          status: saved.status,
        };
      } else {
        const signature = signDescriptor(descriptor, certificatePath, privateKeyPath);
        receipt = await submitPublication(descriptor, signature, requestToken);
        await persistReceipt(
          database,
          bundle,
          descriptor,
          metadata.key_id,
          requestToken,
          receipt,
        );
      }

      lines.push(`BUNDLE ${bundle.bundle_id} SIGNED KEY=${metadata.key_id}`);
      lines.push(
        `BUNDLE ${bundle.bundle_id} PUBLISHED RECEIPT=${receipt.publication_id} ` +
          `TOKEN=${receipt.request_token} STATUS=${receipt.status}`,
      );
    }
  } finally {
    await closeDatabase(database);
  }

  process.stdout.write(lines.length === 0 ? '' : `${lines.join('\n')}\n`);
}

if (!process.argv.includes('--report')) {
  process.stderr.write('Usage: node publisher/release-publisher.mjs --report\n');
  process.exitCode = 2;
} else {
  createReport().catch((error) => {
    process.stderr.write(`release-publisher: ${error.message}\n`);
    process.exitCode = 1;
  });
}
