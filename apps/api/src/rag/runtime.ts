/** Composes RAG persistence, model clients, workers, and application services after explicit migration. */
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';

import { createDatabasePool, createPostgresConnectionString } from '../database.ts';
import type { ApiConfig } from '../env.ts';
import { IngestionWorker } from './ingestionWorker.ts';
import { DefaultKnowledgeService } from './knowledgeService.ts';
import { OpenRouterEmbeddings } from './openRouterEmbeddings.ts';
import { KnowledgeQueryAgent } from './queryAgent.ts';
import { RagRepository } from './repository.ts';

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
  const queryAgent = new KnowledgeQueryAgent({ repository, embeddings, ragConfig: config.rag, checkpointer });
  const worker = new IngestionWorker({
    repository,
    embeddings,
    embeddingModel: config.rag.embeddingModel,
    uploadTempDirectory: config.rag.uploadTempDir,
    concurrency: 2,
  });
  const service = new DefaultKnowledgeService(
    repository,
    queryAgent,
    config.rag.uploadTempDir,
    config.rag.embeddingModel,
  );
  const cleanupExpiredConversations = async () => {
    for (const conversation of await repository.listExpiredConversations()) {
      await checkpointer.deleteThread(conversation.threadId);
      await repository.deleteExpiredConversation(conversation.id);
    }
  };
  const cleanupTimer = setInterval(() => void cleanupExpiredConversations().catch((error: unknown) => {
    console.error('Failed to clean expired RAG conversations', error);
  }), 24 * 60 * 60 * 1_000);
  cleanupTimer.unref();
  void cleanupExpiredConversations().catch((error: unknown) => {
    console.error('Failed to clean expired RAG conversations at startup', error);
  });
  return {
    service,
    worker,
    async close() {
      clearInterval(cleanupTimer);
      await worker.stop();
      await checkpointer.end();
      await pool.end();
    },
  };
}
