/** Starts and gracefully stops the EchoWave Node.js API process. */
import { serve } from '@hono/node-server';

import { createApp } from './app.ts';
import { readApiConfigFile } from './env.ts';
import { formatServerStartError } from './serverError.ts';

const config = readApiConfigFile(new URL('../.env', import.meta.url));
const app = createApp(config);

const server = serve({
  fetch: app.fetch,
  port: config.port,
}, () => {
  console.log(`EchoWave API listening on http://localhost:${config.port}`);
});

server.once('error', (error) => {
  console.error(formatServerStartError(error, config.port));
  process.exitCode = 1;
});

function shutdown(signal: NodeJS.Signals) {
  console.log(`Received ${signal}; shutting down EchoWave API.`);
  server.close((error) => {
    if (error) {
      console.error('Failed to close the API server cleanly.', error);
      process.exitCode = 1;
    }
  });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
