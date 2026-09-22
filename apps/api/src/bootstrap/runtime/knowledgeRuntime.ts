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
import { KnowledgeCategoryRepository } from '../../knowledge/categories/categoryRepository.ts';
import { KnowledgeCategoryService } from '../../knowledge/categories/categoryService.ts';
import { KnowledgeClassifier } from '../../knowledge/categories/classifier.ts';

import type { AiExecutionReporter } from '../../ai-observability/executionReporter.ts';
import {
  chatModelBaseUrl,
  createChatStyleModel,
  isTextChatProvider,
} from '../../ai-runtime/chatModel.ts';
import type { ApiConfig } from '../../config/env.ts';
import type { LiveUpdateBroker } from '../../infrastructure/liveUpdateBroker.ts';
import type { DatabasePool } from '../../infrastructure/postgres.ts';
import type { WorkerWakeupSource } from '../../infrastructure/workerWakeup.ts';
import { createKnowledgeAnswerModule } from '../../knowledge/answer/knowledgeAnswer.ts';
import { KnowledgeQueryAgent } from '../../knowledge/answer/knowledgeQueryAgent.ts';
import { DashScopeEmbeddings } from '../../knowledge/embeddings/dashScopeEmbeddings.ts';
import { KnowledgeCleanupWorker } from '../../knowledge/ingestion/cleanupWorker.ts';
import { KnowledgeCleanupRepository } from '../../knowledge/persistence/cleanupRepository.ts';
import { IngestionWorker } from '../../knowledge/ingestion/worker.ts';
import { KnowledgeRepository } from '../../knowledge/catalog/knowledgeRepository.ts';
import { ConversationRepository } from '../../knowledge/persistence/conversationRepository.ts';
import { IngestionRepository } from '../../knowledge/persistence/ingestionRepository.ts';
import { PostgresKnowledgeSearch } from '../../knowledge/retrieval/postgresKnowledgeSearch.ts';
import { DefaultKnowledgeService } from '../../knowledge/service.ts';
import type { SettingsService } from '../../settings/service.ts';
import type { KnowledgeRetrievalSettingsService } from '../../knowledge/retrieval/settingsService.ts';

type KnowledgeRuntimeOptions = {
  config: ApiConfig;
  pool: DatabasePool;
  liveUpdates: LiveUpdateBroker;
  workerWakeup: WorkerWakeupSource;
  checkpointer: PostgresSaver;
  reporter: AiExecutionReporter;
  settingsService: SettingsService;
  knowledgeRetrievalSettingsService: KnowledgeRetrievalSettingsService;
};

/** 创建知识领域应用服务、检索端口和入库 Worker。 */
export function createKnowledgeRuntime(options: KnowledgeRuntimeOptions) {
  const {
    config,
    pool,
    liveUpdates,
    workerWakeup,
    checkpointer,
    reporter,
    settingsService,
    knowledgeRetrievalSettingsService,
  } = options;
  const knowledgeRepository = new KnowledgeRepository(
    pool,
    config.database.schema,
    config.rag.tenantId,
  );
  const categoryRepository = new KnowledgeCategoryRepository(
    pool,
    config.database.schema,
    config.rag.tenantId,
  );
  const classifier = new KnowledgeClassifier(async () => {
    const chat = await settingsService.resolveCapability('knowledge_chat');
    if (!isTextChatProvider(chat.provider.type) || !('apiKey' in chat.provider.credential))
      throw new Error('Resolved classification provider is incompatible.');
    return {
      name: chat.model,
      provider: chat.provider.type,
      model: createChatStyleModel({
        providerType: chat.provider.type,
        apiKey: chat.provider.credential.apiKey,
        baseUrl: chatModelBaseUrl(
          chat.provider.type,
          chat.provider.config as Record<string, unknown>,
        ),
        model: chat.model,
        maxTokens: 1024,
        thinking: 'disabled',
        extraModelKwargs: { response_format: { type: 'json_object' } },
      }),
    };
  });
  const knowledgeSearch = new PostgresKnowledgeSearch(
    pool,
    config.database.schema,
    config.rag.tenantId,
  );
  const categories = new KnowledgeCategoryService(
    categoryRepository,
    classifier,
    reporter,
    knowledgeSearch,
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
  const answers = createKnowledgeAnswerModule({
    knowledgeRepository: knowledgeSearch,
    conversationRepository,
    checkpointer,
    resolveRuntime: async () => {
      const [embedding, chat, rerank] = await Promise.all([
        settingsService.resolveCapability('knowledge_embedding'),
        settingsService.resolveCapability('knowledge_chat'),
        knowledgeRetrievalSettingsService.freezeRuntime(),
      ]);
      if (
        embedding.provider.type !== 'dashscope' ||
        !('apiKey' in embedding.provider.credential) ||
        !isTextChatProvider(chat.provider.type) ||
        !('apiKey' in chat.provider.credential)
      ) {
        throw new Error('Resolved knowledge providers are incompatible.');
      }
      const embeddingConfig = embedding.provider.config as { baseUrl: string };
      const dynamicRagConfig = {
        ...config.rag,
        embeddingModel: embedding.model as typeof config.rag.embeddingModel,
        chatProvider: chat.provider.type,
        chatApiKey: chat.provider.credential.apiKey,
        chatBaseUrl: chatModelBaseUrl(
          chat.provider.type,
          chat.provider.config as Record<string, unknown>,
        ),
        chatModel: chat.model,
        enableThinking: chat.settings.enableThinking === true,
      };
      return {
        embeddings: new DashScopeEmbeddings({
          apiKey: embedding.provider.credential.apiKey,
          baseUrl: embeddingConfig.baseUrl,
          model: embedding.model,
          dimensions: 1024,
        }),
        agent: new KnowledgeQueryAgent({ ragConfig: dynamicRagConfig, checkpointer }),
        ragConfig: dynamicRagConfig,
        embeddingBindingRevisionId: embedding.revisionId,
        chatBindingRevisionId: chat.revisionId,
        rerank,
      };
    },
    reporter,
  });
  const worker = new IngestionWorker({
    suggestCategories: async (job, parsed, report) =>
      classifier.suggest(job.title, parsed.chunks, (await categoryRepository.list()).items, report),
    repository: ingestionRepository,
    createEmbeddings: async (job) => {
      const resolved = await settingsService.resolveCapability(
        'knowledge_embedding',
        job.embeddingBindingRevisionId ?? undefined,
      );
      if (resolved.provider.type !== 'dashscope' || !('apiKey' in resolved.provider.credential)) {
        throw new Error('Resolved embedding provider is incompatible.');
      }
      return new DashScopeEmbeddings({
        apiKey: resolved.provider.credential.apiKey,
        baseUrl: (resolved.provider.config as { baseUrl: string }).baseUrl,
        model: job.embeddingModel,
        dimensions: 1024,
      });
    },
    uploadTempDirectory: config.rag.uploadTempDir,
    knowledgeStorageDirectory: config.rag.knowledgeStorageDir,
    concurrency: 2,
    reporter,
    wakeup: workerWakeup,
  });
  const service = new DefaultKnowledgeService(
    knowledgeRepository,
    ingestionRepository,
    conversationRepository,
    answers,
    config.rag.knowledgeStorageDir,
    settingsService,
    liveUpdates,
    config.rag.uploadTempDir,
    categories,
  );
  const cleanupWorker = new KnowledgeCleanupWorker(
    new KnowledgeCleanupRepository(pool, config.database.schema, config.rag.tenantId),
    config.rag.knowledgeStorageDir,
    config.rag.uploadTempDir,
    workerWakeup,
  );
  return {
    cleanupWorker,
    service,
    worker,
    knowledgeSearch,
    knowledgeRetrievalSettingsService,
    disposeAnswers: () => answers.dispose(),
  };
}
