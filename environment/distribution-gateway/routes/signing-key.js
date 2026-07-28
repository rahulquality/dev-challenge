'use strict';

const express = require('express');
const { readKeyMetadata } = require('../lib/config');

const router = express.Router();

// GET /v1/signing-key/current
// Publishes the metadata for the key that release bundles must currently be
// signed with. The publisher reads this to discover the active key id and
// signature algorithm before it signs anything.
router.get('/current', (req, res) => {
  const current = readKeyMetadata('current-key.json');
  res.status(200).json({
    key_id: current.key_id,
    algorithm: current.algorithm,
    certificate_ref: current.certificate_ref,
    status: current.status,
  });
});

module.exports = router;
