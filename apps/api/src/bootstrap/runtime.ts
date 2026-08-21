/**
 * RAG 运行时组合根。
 *
 * 负责装配 PostgreSQL、embedding、可信回答、入库 worker 与知识库应用模块，并定义
 * 进程关闭时的资源释放顺序；业务规则必须留在各自深模块内部。
 *
 * Responsibilities:
 * - 创建共享基础设施适配器。
 * - 连接可信回答与知识库应用接口。
 * - 按依赖顺序停止后台任务并关闭连接。
 */
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';

import { createAiExecutionReporter } from '../ai-observability/executionReporter.ts';
import type { ApiConfig } from '../config/env.ts';
import { createDatabasePool, createPostgresConnectionString } from '../infrastructure/postgres.ts';
import { createKnowledgeAnswerModule } from '../knowledge/answer/knowledgeAnswer.ts';
import { DeepSeekQueryAgent } from '../knowledge/answer/deepSeekQueryAgent.ts';
import { OpenRouterEmbeddings } from '../knowledge/embeddings/openRouterEmbeddings.ts';
import { IngestionWorker } from '../knowledge/ingestion/worker.ts';
import { ConversationRepository } from '../knowledge/persistence/conversationRepository.ts';
import { IngestionRepository } from '../knowledge/persistence/ingestionRepository.ts';
import { KnowledgeRepository } from '../knowledge/persistence/knowledgeRepository.ts';
import { DefaultKnowledgeService } from '../knowledge/service.ts';
import { WorkspaceRepository } from '../workspace/persistence/workspaceRepository.ts';
import { DefaultWorkspaceService } from '../workspace/service.ts';

/** 装配完整 RAG 运行时，并返回服务器所需的应用接口、worker 与关闭函数。 */
export function createRagRuntime(config: ApiConfig) {
  const executionReporter = createAiExecutionReporter(config.aiExecutionReports);
  const pool = createDatabasePool(config.database);
  const knowledgeRepository = new KnowledgeRepository(pool, config.database.schema, config.rag.tenantId);
  const ingestionRepository = new IngestionRepository(pool, config.database.schema, config.rag.tenantId);
  const conversationRepository = new ConversationRepository(pool, config.database.schema, config.rag.tenantId);
  const workspaceRepository = new WorkspaceRepository(pool, config.database.schema, config.rag.tenantId);
  const embeddings = new OpenRouterEmbeddings({
    apiKey: config.rag.openRouterApiKey,
    model: config.rag.embeddingModel,
    dimensions: config.rag.embeddingDimensions,
  });
  const checkpointer = PostgresSaver.fromConnString(createPostgresConnectionString(config.database), {
    schema: config.rag.langGraphSchema,
  });
  const queryAgent = new DeepSeekQueryAgent({ ragConfig: config.rag, checkpointer });
  const answers = createKnowledgeAnswerModule({
    knowledgeRepository,
    conversationRepository,
    embeddings,
    agent: queryAgent,
    checkpointer,
    ragConfig: config.rag,
    reporter: executionReporter,
  });
  const worker = new IngestionWorker({
    repository: ingestionRepository,
    embeddings,
    embeddingModel: config.rag.embeddingModel,
    uploadTempDirectory: config.rag.uploadTempDir,
    concurrency: 2,
    reporter: executionReporter,
  });
  const service = new DefaultKnowledgeService(
    knowledgeRepository,
    ingestionRepository,
    conversationRepository,
    answers,
    config.rag.uploadTempDir,
    config.rag.embeddingModel,
  );
  const workspaceService = new DefaultWorkspaceService(workspaceRepository);
  return {
    service,
    workspaceService,
    worker,
    async close() {
      await answers.dispose();
      await worker.stop();
      await checkpointer.end();
      await pool.end();
    },
  };
}
