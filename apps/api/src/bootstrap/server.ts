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
import { createGracefulShutdown, startWorkersAfterListening } from './serverLifecycle.ts';
import { createRagRuntime } from './runtime.ts';

const config = readApiConfigFile(new URL('../../.env', import.meta.url));
const ragRuntime = createRagRuntime(config);
const transcriptionCapabilities = await ragRuntime.audioInputPreprocessor.probeFfmpeg();
if (transcriptionCapabilities.ffmpeg.configured && !transcriptionCapabilities.ffmpeg.available) {
  console.warn('FFmpeg preprocessing is unavailable; DashScope audio transcription is disabled.');
}
if (transcriptionCapabilities.ffmpeg.available && !transcriptionCapabilities.sileroVad.available) {
  console.warn('Silero VAD is unavailable; whole-file audio transcription remains available.');
}
const app = createApp(config, {
  knowledgeService: ragRuntime.service,
  workspaceService: ragRuntime.workspaceService,
  liveUpdateBroker: ragRuntime.liveUpdates,
  ...(ragRuntime.dashScopeCallbackService
    ? { dashScopeCallbackService: ragRuntime.dashScopeCallbackService }
    : {}),
});
const server = serve({
  fetch: app.fetch,
  port: config.port,
});
const shutdown = createGracefulShutdown({
  server,
  closeRuntime: () => ragRuntime.close(),
});

let startupCompleted = false;
try {
  await startWorkersAfterListening(server, async () => {
    await ragRuntime.workerWakeup.start();
    ragRuntime.worker.start();
    await ragRuntime.transcriptionWorker.start();
    await Promise.all([
      ragRuntime.emotionWorker.start(),
      ragRuntime.roleWorker.start(),
      ragRuntime.businessAnalysisWorker.start(),
    ]);
  });
  startupCompleted = true;
  console.log(`EchoWave API listening on http://localhost:${config.port}`);
} catch (error) {
  console.error(
    formatServerStartError(
      error instanceof Error ? error : new Error('Unknown API startup failure.'),
      config.port,
    ),
  );
  try {
    await shutdown(1);
  } catch (shutdownError) {
    console.error('Failed to release the API runtime after startup failure.', shutdownError);
  }
  process.exitCode = 1;
}

/** 收到系统信号后先停止接收新连接，再释放 RAG 运行时资源。 */
async function handleShutdown(signal: NodeJS.Signals, exitCode = 0) {
  console.log(`Received ${signal}; shutting down EchoWave API.`);
  try {
    await shutdown(exitCode);
    process.exitCode = exitCode;
  } catch (error) {
    console.error('Failed to close the API server cleanly.', error);
    process.exitCode = 1;
  }
}

if (startupCompleted) {
  server.on('error', (error) => {
    console.error(formatServerStartError(error, config.port));
    void handleShutdown('SIGTERM', 1);
  });
  process.once('SIGINT', (signal) => void handleShutdown(signal));
  process.once('SIGTERM', (signal) => void handleShutdown(signal));
}
