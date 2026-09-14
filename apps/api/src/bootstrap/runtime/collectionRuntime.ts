/**
 * 案例收集 runtime 工厂。
 *
 * 装配收集仓储、服务、媒体和工作流 Worker，复用知识入库能力。
 *
 * Responsibilities:
 * - 将共享连接和既有领域服务注入案例生命周期。
 *
 * Notes:
 * - 不独立创建数据库或模型供应商。
 */
import type { ApiConfig } from '../../config/env.ts';
import type { DatabasePool } from '../../infrastructure/postgres.ts';
import type { WorkerWakeupSource } from '../../infrastructure/workerWakeup.ts';
import type { LiveUpdateBroker } from '../../infrastructure/liveUpdateBroker.ts';
import type { AudioService } from '../../workspace/audio/core/service.ts';
import type { SettingsService } from '../../settings/service.ts';
import type { KnowledgeService } from '../../knowledge/service.ts';
import { IngestionRepository } from '../../knowledge/persistence/ingestionRepository.ts';
import { CollectionRepository } from '../../knowledge/collection/repository.ts';
import { CollectionService } from '../../knowledge/collection/service.ts';
import { CaseMediaStore } from '../../knowledge/collection/media.ts';
import { CollectionWorker } from '../../knowledge/collection/worker.ts';

/** 创建案例服务与后台 Worker。 */
export function createCollectionRuntime(options: {
  config: ApiConfig;
  pool: DatabasePool;
  wakeup: WorkerWakeupSource;
  liveUpdates: LiveUpdateBroker;
  audio: AudioService;
  settings: SettingsService;
  knowledge: KnowledgeService;
}) {
  const { config, pool } = options;
  const repository = new CollectionRepository(pool, config.database.schema, config.rag.tenantId);
  const media = new CaseMediaStore({
    knowledgeDirectory: config.rag.knowledgeStorageDir,
    audioDirectory: config.rag.audioStorageDir,
    tempDirectory: config.rag.audioTranscriptionTempDir,
    ...(config.rag.ffmpegPath ? { ffmpegPath: config.rag.ffmpegPath } : {}),
    audio: options.audio,
  });
  const service = new CollectionService(
    repository,
    new IngestionRepository(pool, config.database.schema, config.rag.tenantId, options.liveUpdates),
    options.knowledge,
    options.settings,
    media,
  );
  return { service, worker: new CollectionWorker(service, options.wakeup) };
}
