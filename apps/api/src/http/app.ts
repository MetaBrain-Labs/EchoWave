/**
 * Hono HTTP 应用组合入口。
 *
 * 创建应用、配置跨域并按领域注册路由和稳定错误处理，不承载具体 route handler。
 *
 * Responsibilities:
 * - 组合可选业务服务和实时通知设施。
 * - 安装 CORS、路由、404 与错误映射。
 *
 * Notes:
 * - 网络监听和资源生命周期由 bootstrap 负责。
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';

import type { ApiConfig } from '../config/env.ts';
import { LiveUpdateBroker } from '../infrastructure/liveUpdateBroker.ts';
import type { KnowledgeService } from '../knowledge/service.ts';
import type { AudioService } from '../workspace/audio/core/service.ts';
import type { AudioRuntimeService } from '../workspace/audio/runtime-mode/service.ts';
import type { AudioUploadSessionService } from '../workspace/audio/runtime-mode/uploadSessionService.ts';
import type { DataSourceService } from '../workspace/data-sources/service.ts';
import type { GroupService } from '../workspace/groups/service.ts';
import type { SettingsService } from '../settings/service.ts';
import type { DashScopeCallbackService } from '../workspace/audio/transcription/dashScopeCallback.ts';
import { installErrorHandlers } from './errorHandler.ts';
import { registerAudioRoutes } from './routes/audio.ts';
import { registerAudioRuntimeRoutes } from './routes/audioRuntime.ts';
import { registerAudioUploadRoutes } from './routes/audioUploads.ts';
import { registerDashScopeWebhookRoutes } from './routes/dashScopeWebhook.ts';
import { registerDataSourceRoutes } from './routes/dataSources.ts';
import { registerGroupRoutes } from './routes/groups.ts';
import { registerHealthRoutes } from './routes/health.ts';
import { registerKnowledgeRoutes } from './routes/knowledge.ts';
import { registerSettingsRoutes } from './routes/settings.ts';

export type AppDependencies = {
  dashScopeCallbackService?: DashScopeCallbackService;
  knowledgeService?: KnowledgeService;
  groupService?: GroupService;
  dataSourceService?: DataSourceService;
  audioService?: AudioService;
  audioRuntimeService?: AudioRuntimeService;
  audioUploadService?: AudioUploadSessionService;
  liveUpdateBroker?: LiveUpdateBroker;
  settingsService?: SettingsService;
  trustedProxyCidrs?: string[];
};

/** 创建不启动监听器的 Hono 应用，使生产服务器和测试共享传输入口。 */
export function createApp(
  config: Pick<ApiConfig, 'corsOrigins'>,
  dependencies: AppDependencies = {},
) {
  const app = new Hono();
  const liveUpdates = dependencies.liveUpdateBroker ?? new LiveUpdateBroker();

  app.use(
    '*',
    cors({
      origin: config.corsOrigins,
      allowMethods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Authorization', 'Content-Type', 'Range', 'X-Audio-Filename'],
      exposeHeaders: ['Accept-Ranges', 'Content-Length', 'Content-Range', 'Last-Modified'],
    }),
  );

  registerHealthRoutes(app);
  if (dependencies.settingsService) {
    registerSettingsRoutes(app, dependencies.settingsService, dependencies.trustedProxyCidrs ?? []);
  }
  if (dependencies.dashScopeCallbackService) {
    registerDashScopeWebhookRoutes(app, dependencies.dashScopeCallbackService);
  }
  if (dependencies.knowledgeService) {
    registerKnowledgeRoutes(app, dependencies.knowledgeService, liveUpdates);
  }
  if (dependencies.groupService) registerGroupRoutes(app, dependencies.groupService);
  if (dependencies.dataSourceService) {
    registerDataSourceRoutes(app, dependencies.dataSourceService, liveUpdates);
  }
  if (dependencies.audioService) registerAudioRoutes(app, dependencies.audioService, liveUpdates);
  if (dependencies.audioRuntimeService) {
    registerAudioRuntimeRoutes(app, dependencies.audioRuntimeService);
  }
  if (dependencies.audioUploadService) {
    registerAudioUploadRoutes(app, dependencies.audioUploadService);
  }
  installErrorHandlers(app);
  return app;
}

/** EchoWave Hono 应用的推断类型。 */
export type EchoWaveApp = ReturnType<typeof createApp>;
