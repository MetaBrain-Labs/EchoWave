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

import { createDatabasePool, createPostgresConnectionString } from '../database.ts';
import type { ApiConfig } from '../env.ts';
import { IngestionWorker } from './ingestionWorker.ts';
import { createKnowledgeAnswerModule } from './knowledgeAnswer.ts';
import { DefaultKnowledgeService } from './knowledgeService.ts';
import { OpenRouterEmbeddings } from './openRouterEmbeddings.ts';
import { DeepSeekQueryAgent } from './queryAgent.ts';
import { RagRepository } from './repository.ts';

/** 装配完整 RAG 运行时，并返回服务器所需的应用接口、worker 与关闭函数。 */
export function createRagRuntime(config: ApiConfig) {
  const pool = createDatabasePool(config.database);
  const repository = new RagRepository(pool, config.database.schema, config.rag.tenantId);
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
    repository,
    embeddings,
    agent: queryAgent,
    checkpointer,
    ragConfig: config.rag,
  });
  const worker = new IngestionWorker({
    repository,
    embeddings,
    embeddingModel: config.rag.embeddingModel,
    uploadTempDirectory: config.rag.uploadTempDir,
    concurrency: 2,
  });
  const service = new DefaultKnowledgeService(
    repository,
    answers,
    config.rag.uploadTempDir,
    config.rag.embeddingModel,
  );
  return {
    service,
    worker,
    async close() {
      await answers.dispose();
      await worker.stop();
      await checkpointer.end();
      await pool.end();
    },
  };
}
