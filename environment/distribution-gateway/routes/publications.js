'use strict';

const express = require('express');
const { verifyDetachedSignature, canonicalEncode } = require('../lib/signature-verify');

// Builds the publications router bound to a specific publication ledger.
function createPublicationsRouter(ledger) {
  const router = express.Router();

  // POST /v1/publications
  // Body: { descriptor, signature, request_token }
  //   descriptor    - the canonical release descriptor. Accepted either as the
  //                   raw canonical JSON string (verified byte-for-byte) or as an
  //                   object, which the gateway re-canonicalizes the same way both
  //                   sides agree (UTF-8 JSON, sorted keys, no whitespace).
  //   signature     - detached CMS signature (PEM) over the canonical descriptor.
  //   request_token - caller-supplied token; a repeat with the same token replays
  //                   the original receipt without creating a second publication.
  router.post('/', (req, res) => {
    const body = req.body || {};
    const { descriptor, signature, request_token: requestToken } = body;

    if (typeof requestToken !== 'string' || requestToken.length === 0) {
      return res
        .status(400)
        .json({ error: 'MISSING_REQUEST_TOKEN', message: 'request_token is required.' });
    }
    if (typeof signature !== 'string' || signature.length === 0) {
      return res
        .status(400)
        .json({ error: 'MISSING_SIGNATURE', message: 'signature (detached CMS, PEM) is required.' });
    }
    if (descriptor === undefined || descriptor === null) {
      return res
        .status(400)
        .json({ error: 'MISSING_DESCRIPTOR', message: 'descriptor payload is required.' });
    }

    // Idempotent replay: a token we already published under returns its receipt.
    const replay = ledger.lookupByToken(requestToken);
    if (replay) {
      return res.status(200).json(replay);
    }

    // Recover the exact bytes that were signed. A string descriptor is the
    // canonical payload verbatim; an object descriptor is canonicalized here.
    const descriptorBytes =
      typeof descriptor === 'string'
        ? Buffer.from(descriptor, 'utf8')
        : Buffer.from(canonicalEncode(descriptor), 'utf8');

    const outcome = verifyDetachedSignature(descriptorBytes, signature);
    if (!outcome.trusted) {
      // Rejected before anything is written: the signing key does not chain to
      // the current certificate (e.g. a descriptor signed with the revoked key).
      return res.status(400).json({
        error: 'UNTRUSTED_SIGNATURE',
        message: 'Descriptor signature did not verify against the current signing certificate.',
      });
    }

    const stored = typeof descriptor === 'string' ? descriptor : canonicalEncode(descriptor);
    const receipt = ledger.commit(requestToken, stored);
    return res.status(200).json(receipt);
  });

  return router;
}

module.exports = { createPublicationsRouter };
