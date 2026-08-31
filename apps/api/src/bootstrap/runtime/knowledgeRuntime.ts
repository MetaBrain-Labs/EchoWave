/**
 * 知识领域 runtime 工厂。
 *
 * 装配知识目录、检索、可信问答、会话和入库 Worker，并返回显式领域能力。
 *
 * Responsibilities:
 * - 创建知识领域 Repository、Agent、Service 与 Worker。
 * - 暴露共享检索端口供音频业务分析使用。
 *
 * Notes:
 * - 数据库连接、checkpoint 和报告器由顶层组合根创建。
 */
import type { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';

import type { AiExecutionReporter } from '../../ai-observability/executionReporter.ts';
import type { ApiConfig } from '../../config/env.ts';
import type { LiveUpdateBroker } from '../../infrastructure/liveUpdateBroker.ts';
import type { DatabasePool } from '../../infrastructure/postgres.ts';
import type { WorkerWakeupSource } from '../../infrastructure/workerWakeup.ts';
import { createKnowledgeAnswerModule } from '../../knowledge/answer/knowledgeAnswer.ts';
import { DeepSeekQueryAgent } from '../../knowledge/answer/deepSeekQueryAgent.ts';
import type { DashScopeEmbeddings } from '../../knowledge/embeddings/dashScopeEmbeddings.ts';
import { IngestionWorker } from '../../knowledge/ingestion/worker.ts';
import { KnowledgeRepository } from '../../knowledge/catalog/knowledgeRepository.ts';
import { ConversationRepository } from '../../knowledge/persistence/conversationRepository.ts';
import { IngestionRepository } from '../../knowledge/persistence/ingestionRepository.ts';
import { PostgresKnowledgeSearch } from '../../knowledge/retrieval/postgresKnowledgeSearch.ts';
import { DefaultKnowledgeService } from '../../knowledge/service.ts';

type KnowledgeRuntimeOptions = {
  config: ApiConfig;
  pool: DatabasePool;
  liveUpdates: LiveUpdateBroker;
  workerWakeup: WorkerWakeupSource;
  embeddings: DashScopeEmbeddings;
  checkpointer: PostgresSaver;
  reporter: AiExecutionReporter;
};

/** 创建知识领域应用服务、检索端口和入库 Worker。 */
export function createKnowledgeRuntime(options: KnowledgeRuntimeOptions) {
  const { config, pool, liveUpdates, workerWakeup, embeddings, checkpointer, reporter } = options;
  const knowledgeRepository = new KnowledgeRepository(
    pool,
    config.database.schema,
    config.rag.tenantId,
  );
  const knowledgeSearch = new PostgresKnowledgeSearch(
    pool,
    config.database.schema,
    config.rag.tenantId,
  );
  const ingestionRepository = new IngestionRepository(
    pool,
    config.database.schema,
    config.rag.tenantId,
    liveUpdates,
  );
  const conversationRepository = new ConversationRepository(
    pool,
    config.database.schema,
    config.rag.tenantId,
  );
  const queryAgent = new DeepSeekQueryAgent({ ragConfig: config.rag, checkpointer });
  const answers = createKnowledgeAnswerModule({
    knowledgeRepository: knowledgeSearch,
    conversationRepository,
    embeddings,
    agent: queryAgent,
    checkpointer,
    ragConfig: config.rag,
    reporter,
  });
  const worker = new IngestionWorker({
    repository: ingestionRepository,
    embeddings,
    embeddingModel: config.rag.embeddingModel,
    uploadTempDirectory: config.rag.uploadTempDir,
    concurrency: 2,
    reporter,
    wakeup: workerWakeup,
  });
  const service = new DefaultKnowledgeService(
    knowledgeRepository,
    ingestionRepository,
    conversationRepository,
    answers,
    config.rag.uploadTempDir,
    config.rag.embeddingModel,
  );
  return {
    service,
    worker,
    knowledgeSearch,
    disposeAnswers: () => answers.dispose(),
  };
}
