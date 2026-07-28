'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { ledgerDir } = require('./config');

// Private ledger of published release bundles. This ledger is NOT reachable over
// HTTP: the publisher observes publication state only through the documented
// endpoints. Layout: a single JSON document with a `publications` map keyed by
// publication id and a `tokenIndex` mapping request token -> publication id, so a
// repeated upload with the same token replays the original receipt instead of
// creating a second publication.
class PublicationLedger {
  constructor(file) {
    this.file = file || path.join(ledgerDir(), 'gateway.json');
    this.state = { publications: {}, tokenIndex: {} };
    this._hydrate();
  }

  _hydrate() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.state = {
        publications: parsed.publications || {},
        tokenIndex: parsed.tokenIndex || {},
      };
    } catch (err) {
      if (err.code !== 'ENOENT') {
        throw err;
      }
      // Nothing written yet; the file appears on the first accepted upload.
    }
  }

  _flush() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.state, null, 2));
  }

  // Existing receipt for a request token, or null when the token is unseen.
  lookupByToken(requestToken) {
    const publicationId = this.state.tokenIndex[requestToken];
    if (!publicationId) {
      return null;
    }
    return this._receiptFor(publicationId);
  }

  // Records a freshly accepted publication and returns its receipt. The caller
  // must have confirmed the request token is not already recorded.
  commit(requestToken, descriptor) {
    const publicationId = this._mintPublicationId();
    this.state.publications[publicationId] = {
      publication_id: publicationId,
      request_token: requestToken,
      status: 'PUBLISHED',
      descriptor,
    };
    this.state.tokenIndex[requestToken] = publicationId;
    this._flush();
    return this._receiptFor(publicationId);
  }

  size() {
    return Object.keys(this.state.publications).length;
  }

  _receiptFor(publicationId) {
    const row = this.state.publications[publicationId];
    if (!row) {
      return null;
    }
    return {
      publication_id: row.publication_id,
      request_token: row.request_token,
      status: row.status,
    };
  }

  _mintPublicationId() {
    return 'pub_' + crypto.randomBytes(12).toString('hex');
  }
}

module.exports = { PublicationLedger };
