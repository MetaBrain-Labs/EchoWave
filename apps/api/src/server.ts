/** Starts and gracefully stops the EchoWave Node.js API process. */
import { serve } from '@hono/node-server';

import { createApp } from './app.ts';
import { readApiConfigFile } from './env.ts';
import { formatServerStartError } from './serverError.ts';
import { createRagRuntime } from './rag/runtime.ts';

const config = readApiConfigFile(new URL('../.env', import.meta.url));
const ragRuntime = createRagRuntime(config);
const app = createApp(config, { knowledgeService: ragRuntime.service });
ragRuntime.worker.start();

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
  server.close(async (error) => {
    if (error) {
      console.error('Failed to close the API server cleanly.', error);
      process.exitCode = 1;
    }
    await ragRuntime.close();
  });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
