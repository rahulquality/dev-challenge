'use strict';

const { buildApp } = require('./app');
const { listenPort } = require('./lib/config');

const app = buildApp();
const boundPort = listenPort();

app.listen(boundPort, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`distribution-gateway listening on ${boundPort}`);
});
