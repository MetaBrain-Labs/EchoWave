/**
 * API 进程入口。
 *
 * 负责读取配置、装配 RAG 运行时、启动 Hono Node 监听器，并在系统信号到达时按顺序
 * 关闭网络与后台资源。
 *
 * Responsibilities:
 * - 启动 API 与入库 worker。
 * - 报告可操作的监听失败信息。
 * - 协调优雅停机。
 *
 * Notes:
 * - 领域行为留在 app 与 RAG 模块中。
 */
import { serve } from '@hono/node-server';

import { readApiConfigFile } from '../config/env.ts';
import { createApp } from '../http/app.ts';
import { formatServerStartError } from './serverError.ts';
import { createRagRuntime } from './runtime.ts';

const config = readApiConfigFile(new URL('../../.env', import.meta.url));
const ragRuntime = createRagRuntime(config);
const app = createApp(config, {
  knowledgeService: ragRuntime.service,
  workspaceService: ragRuntime.workspaceService,
});
ragRuntime.worker.start();

const server = serve(
  {
    fetch: app.fetch,
    port: config.port,
  },
  () => {
    console.log(`EchoWave API listening on http://localhost:${config.port}`);
  },
);

server.once('error', (error) => {
  console.error(formatServerStartError(error, config.port));
  process.exitCode = 1;
});

/** 收到系统信号后先停止接收新连接，再释放 RAG 运行时资源。 */
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
