'use strict';

const fs = require('fs');
const path = require('path');

// The current code-signing certificate is created when the container image is
// built and installed at a fixed absolute path. It can be redirected with
// CURRENT_CERT_PATH so the gateway can be exercised outside the container (the
// bundled test suite points this at an ephemeral certificate it mints).
const DEFAULT_CURRENT_CERT_PATH = '/app/keys/current/current.cert.pem';

function currentCertPath() {
  return process.env.CURRENT_CERT_PATH || DEFAULT_CURRENT_CERT_PATH;
}

function listenPort() {
  const raw = process.env.PORT;
  if (raw === undefined || raw === '') {
    return 7070;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? 7070 : parsed;
}

// Where the gateway's private publication ledger is written. Created on demand.
function ledgerDir() {
  return process.env.GATEWAY_DATA_DIR || path.join(__dirname, '..', 'data');
}

function readKeyMetadata(fileName) {
  const file = path.join(__dirname, '..', 'fixtures', fileName);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

module.exports = {
  DEFAULT_CURRENT_CERT_PATH,
  currentCertPath,
  listenPort,
  ledgerDir,
  readKeyMetadata,
};
