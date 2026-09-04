/**
 * EchoWave API runtime 组合根。
 *
 * 只创建跨领域共享资源，调用 knowledge、workspace、audio 工厂，并定义统一关闭顺序。
 *
 * Responsibilities:
 * - 创建数据库、checkpoint、报告器、broker 与 Worker 唤醒器。
 * - 按领域装配运行时并保持既有关闭顺序。
 *
 * Notes:
 * - 业务 Repository、Service 和 Worker 的具体装配留在领域 runtime 工厂。
 */
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';

import {
  createAiExecutionReporter,
  createCompositeAiExecutionReporter,
} from '../ai-observability/executionReporter.ts';
import { createSttRawResponseReporter } from '../ai-observability/sttRawResponseReporter.ts';
import type { ApiConfig } from '../config/env.ts';
import { LiveUpdateBroker } from '../infrastructure/liveUpdateBroker.ts';
import { createDatabasePool, createPostgresConnectionString } from '../infrastructure/postgres.ts';
import { PostgresWorkerWakeup } from '../infrastructure/workerWakeup.ts';
import { PostgresAudioExecutionRepository } from '../workspace/audio/execution/postgresAudioExecutionRepository.ts';
import { AudioRuntimeRepository } from '../workspace/audio/runtime-mode/repository.ts';
import { AudioRuntimeService } from '../workspace/audio/runtime-mode/service.ts';
import { AudioUploadSessionRepository } from '../workspace/audio/runtime-mode/uploadSessionRepository.ts';
import { AudioUploadSessionService } from '../workspace/audio/runtime-mode/uploadSessionService.ts';
import { DatabaseCredentialProvider } from '../settings/credentials/databaseCredentialProvider.ts';
import { LocalCredentialProvider } from '../settings/credentials/localCredentialProvider.ts';
import { SettingsRepository } from '../settings/repository.ts';
import { SettingsService, type LegacyAiConfiguration } from '../settings/service.ts';
import { createAudioRuntime } from './runtime/audioRuntime.ts';
import { createKnowledgeRuntime } from './runtime/knowledgeRuntime.ts';
import { createWorkspaceRuntime } from './runtime/workspaceRuntime.ts';
import { AudioAutomationRepository } from '../workspace/audio/automation/repository.ts';
import { AudioAutomationService } from '../workspace/audio/automation/service.ts';
import { AudioAutomationWorker } from '../workspace/audio/automation/worker.ts';
import { PushNotificationRepository } from '../notifications/repository.ts';
import { PushDeviceService } from '../notifications/service.ts';
import { PushNotificationWorker } from '../notifications/worker.ts';
import { AudioAnalysisRunsRepository } from '../workspace/audio/analysis-runs/repository.ts';
import { AudioAnalysisRunsService } from '../workspace/audio/analysis-runs/service.ts';

/** 装配完整 API 运行时，并返回服务器依赖、Worker 与关闭函数。 */
export function createRagRuntime(config: ApiConfig) {
  const executionReporter = createAiExecutionReporter(config.aiExecutionReports);
  const sttRawResponseReporter = createSttRawResponseReporter({
    enabled: config.aiExecutionReports.includeSttRawResponses,
    outputDirectory: config.aiExecutionReports.outputDirectory,
  });
  const pool = createDatabasePool(config.database);
  const settingsRepository = new SettingsRepository(
    pool,
    config.database.schema,
    config.rag.tenantId,
  );
  const localCredentials = new LocalCredentialProvider(
    config.settingsSecurity.localCredentialsFile,
  );
  const databaseCredentials = new DatabaseCredentialProvider(
    settingsRepository,
    config.rag.tenantId,
    config.settingsSecurity.credentialMasterKey,
  );
  const legacyConfiguration: LegacyAiConfiguration = {
    detectedVariables: config.legacyProviders.detectedVariables,
    missingVariables: config.legacyProviders.missingVariables,
    ...(config.legacyProviders.dashScope
      ? {
          dashScope: {
            config: {
              baseUrl: config.legacyProviders.dashScope.baseUrl,
              compatibleBaseUrl: config.legacyProviders.dashScope.compatibleBaseUrl,
              asyncNotifyMode: config.legacyProviders.dashScope.asyncNotifyMode,
              eventBridgeCallbackUrl:
                config.legacyProviders.dashScope.eventBridgeCallback?.url ?? null,
            },
            credential: {
              apiKey: config.legacyProviders.dashScope.apiKey,
              ...(config.legacyProviders.dashScope.eventBridgeCallback
                ? {
                    eventBridgeCallbackToken:
                      config.legacyProviders.dashScope.eventBridgeCallback.token,
                  }
                : {}),
            },
          },
        }
      : {}),
    ...(config.legacyProviders.deepSeek
      ? {
          deepSeek: {
            config: { baseUrl: config.legacyProviders.deepSeek.baseUrl },
            credential: { apiKey: config.legacyProviders.deepSeek.apiKey },
            enableThinking: config.legacyProviders.deepSeek.enableThinking,
          },
        }
      : {}),
    ...(config.rag.dashScope.oss
      ? {
          oss: {
            config: {
              region: config.rag.dashScope.oss.region,
              bucket: config.rag.dashScope.oss.bucket,
            },
            credential: {
              accessKeyId: config.rag.dashScope.oss.accessKeyId,
              accessKeySecret: config.rag.dashScope.oss.accessKeySecret,
            },
          },
        }
      : {}),
  };
  const settingsService = new SettingsService(
    settingsRepository,
    databaseCredentials,
    localCredentials,
    config.rag.tenantId,
    config.settingsSecurity.credentialMasterKey,
    config.settingsSecurity.configurationAdminToken,
    legacyConfiguration,
  );
  const liveUpdates = new LiveUpdateBroker();
  const workerWakeup = new PostgresWorkerWakeup(pool, config.database.schema, config.rag.tenantId);
  const audioExecutionRepository = new PostgresAudioExecutionRepository(
    pool,
    config.database.schema,
    config.rag.tenantId,
    liveUpdates,
  );
  const audioExecutionReporter = createCompositeAiExecutionReporter([
    executionReporter,
    audioExecutionRepository.createReporter(),
  ]);
  const checkpointer = PostgresSaver.fromConnString(
    createPostgresConnectionString(config.database),
    { schema: config.rag.langGraphSchema },
  );
  const knowledge = createKnowledgeRuntime({
    config,
    pool,
    liveUpdates,
    workerWakeup,
    checkpointer,
    reporter: executionReporter,
    settingsService,
  });
  const audioRuntimeRepository = new AudioRuntimeRepository(
    pool,
    config.database.schema,
    config.rag.tenantId,
  );
  const workspace = createWorkspaceRuntime({ config, pool, audioRuntimeRepository });
  const audio = createAudioRuntime({
    config,
    pool,
    liveUpdates,
    workerWakeup,
    checkpointer,
    knowledgeSearch: knowledge.knowledgeSearch,
    audioCoreRepository: workspace.audioCoreRepository,
    audioExecutionRepository,
    reporter: audioExecutionReporter,
    sttRawResponseReporter,
    settingsService,
  });
  const audioRuntimeService = new AudioRuntimeService(
    audioRuntimeRepository,
    settingsService,
    audio.audioInputPreprocessor,
  );
  const audioUploadService = new AudioUploadSessionService(
    new AudioUploadSessionRepository(pool, config.database.schema, config.rag.tenantId),
    audioRuntimeRepository,
    settingsService,
    audio.audioService,
    {
      audioStorageDirectory: config.rag.audioStorageDir,
      tempDirectory: config.rag.audioTranscriptionTempDir,
      tenantId: config.rag.tenantId,
    },
  );
  const audioAutomationRepository = new AudioAutomationRepository(
    pool,
    config.database.schema,
    config.rag.tenantId,
  );
  const audioAutomationService = new AudioAutomationService(
    audioAutomationRepository,
    audioUploadService,
    settingsService,
  );
  const audioAutomationWorker = new AudioAutomationWorker({
    repository: audioAutomationRepository,
    audio: audio.audioService,
    wakeup: workerWakeup,
  });
  const audioAnalysisRunsService = new AudioAnalysisRunsService(
    new AudioAnalysisRunsRepository(pool, config.database.schema, config.rag.tenantId),
  );
  const pushNotificationRepository = new PushNotificationRepository(
    pool,
    config.database.schema,
    config.rag.tenantId,
  );
  const pushDeviceService = new PushDeviceService(pushNotificationRepository);
  const pushNotificationWorker = new PushNotificationWorker({
    repository: pushNotificationRepository,
    wakeup: workerWakeup,
    ...(config.notifications.expoPushAccessToken
      ? { accessToken: config.notifications.expoPushAccessToken }
      : {}),
  });

  return {
    service: knowledge.service,
    groupService: workspace.groupService,
    dataSourceService: workspace.dataSourceService,
    audioService: audio.audioService,
    audioRuntimeService,
    audioUploadService,
    audioAutomationService,
    audioAnalysisRunsService,
    pushDeviceService,
    worker: knowledge.worker,
    transcriptionWorker: audio.transcriptionWorker,
    dashScopeCallbackService: audio.dashScopeCallbackService,
    emotionWorker: audio.emotionWorker,
    roleWorker: audio.roleWorker,
    speakerReviewWorker: audio.speakerReviewWorker,
    businessAnalysisWorker: audio.businessAnalysisWorker,
    audioAutomationWorker,
    pushNotificationWorker,
    audioInputPreprocessor: audio.audioInputPreprocessor,
    cleanupExpiredAudio: audio.cleanupExpiredAudio,
    startSourceCleanup: audio.startSourceCleanup,
    liveUpdates,
    workerWakeup,
    settingsService,
    async close(): Promise<void> {
      await knowledge.disposeAnswers();
      await Promise.all([audioAutomationWorker.stop(), pushNotificationWorker.stop()]);
      await audio.stop();
      await knowledge.worker.stop();
      await workerWakeup.close();
      await checkpointer.end();
      await pool.end();
    },
  };
}
