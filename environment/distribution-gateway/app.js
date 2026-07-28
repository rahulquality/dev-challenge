'use strict';

const express = require('express');

const signingKeyRouter = require('./routes/signing-key');
const { createPublicationsRouter } = require('./routes/publications');
const { PublicationLedger } = require('./lib/publication-store');

// Assembles the Express application. A ledger can be injected (the test suite
// supplies a temp-file ledger); otherwise the process-wide ledger under data/ is
// used.
function buildApp(options = {}) {
  const ledger = options.ledger || new PublicationLedger(options.ledgerFile);

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/healthz', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.use('/v1/signing-key', signingKeyRouter);
  app.use('/v1/publications', createPublicationsRouter(ledger));

  return app;
}

module.exports = { buildApp };
