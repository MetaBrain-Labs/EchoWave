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
import { DatabaseCredentialProvider } from '../settings/credentials/databaseCredentialProvider.ts';
import { LocalCredentialProvider } from '../settings/credentials/localCredentialProvider.ts';
import { SettingsRepository } from '../settings/repository.ts';
import { SettingsService, type LegacyAiConfiguration } from '../settings/service.ts';
import { createAudioRuntime } from './runtime/audioRuntime.ts';
import { createKnowledgeRuntime } from './runtime/knowledgeRuntime.ts';
import { createWorkspaceRuntime } from './runtime/workspaceRuntime.ts';

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
  const workspace = createWorkspaceRuntime({ config, pool });
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

  return {
    service: knowledge.service,
    groupService: workspace.groupService,
    dataSourceService: workspace.dataSourceService,
    audioService: audio.audioService,
    worker: knowledge.worker,
    transcriptionWorker: audio.transcriptionWorker,
    dashScopeCallbackService: audio.dashScopeCallbackService,
    emotionWorker: audio.emotionWorker,
    roleWorker: audio.roleWorker,
    speakerReviewWorker: audio.speakerReviewWorker,
    businessAnalysisWorker: audio.businessAnalysisWorker,
    audioInputPreprocessor: audio.audioInputPreprocessor,
    liveUpdates,
    workerWakeup,
    settingsService,
    async close(): Promise<void> {
      await knowledge.disposeAnswers();
      await audio.stop();
      await knowledge.worker.stop();
      await workerWakeup.close();
      await checkpointer.end();
      await pool.end();
    },
  };
}
