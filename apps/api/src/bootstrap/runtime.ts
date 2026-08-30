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

import {
  createAiExecutionReporter,
  createCompositeAiExecutionReporter,
} from '../ai-observability/executionReporter.ts';
import { createSttRawResponseReporter } from '../ai-observability/sttRawResponseReporter.ts';
import type { ApiConfig } from '../config/env.ts';
import { createDatabasePool, createPostgresConnectionString } from '../infrastructure/postgres.ts';
import { LiveUpdateBroker } from '../infrastructure/liveUpdateBroker.ts';
import { PostgresWorkerWakeup } from '../infrastructure/workerWakeup.ts';
import { createKnowledgeAnswerModule } from '../knowledge/answer/knowledgeAnswer.ts';
import { DeepSeekQueryAgent } from '../knowledge/answer/deepSeekQueryAgent.ts';
import { DashScopeEmbeddings } from '../knowledge/embeddings/dashScopeEmbeddings.ts';
import { IngestionWorker } from '../knowledge/ingestion/worker.ts';
import { ConversationRepository } from '../knowledge/persistence/conversationRepository.ts';
import { IngestionRepository } from '../knowledge/persistence/ingestionRepository.ts';
import { KnowledgeRepository } from '../knowledge/persistence/knowledgeRepository.ts';
import { DefaultKnowledgeService } from '../knowledge/service.ts';
import { WorkspaceRepository } from '../workspace/persistence/workspaceRepository.ts';
import { AudioAnalysisRepository } from '../workspace/persistence/audioAnalysisRepository.ts';
import { PostAnalysisRepository } from '../workspace/persistence/postAnalysisRepository.ts';
import { TranscriptConfirmationRepository } from '../workspace/persistence/transcriptConfirmationRepository.ts';
import { DefaultWorkspaceService } from '../workspace/service.ts';
import { AudioInputPreprocessor } from '../workspace/transcription/audioPreprocessor.ts';
import { DashScopeFileTranscription } from '../workspace/transcription/dashScopeFileTranscription.ts';
import { DashScopeCallbackService } from '../workspace/transcription/dashScopeCallback.ts';
import { EventBridgeSignatureVerifier } from '../workspace/transcription/eventBridgeSignature.ts';
import { OssStagingStore } from '../workspace/transcription/ossStagingStore.ts';
import { AudioTranscriptionWorker } from '../workspace/transcription/worker.ts';
import { AudioWindowPreprocessor } from '../workspace/post-analysis/audioWindowPreprocessor.ts';
import { DeepSeekRoleRecognizer } from '../workspace/post-analysis/deepSeekRoleRecognizer.ts';
import { QwenEmotionAnalyzer } from '../workspace/post-analysis/qwenEmotionAnalyzer.ts';
import { AudioPostAnalysisWorker } from '../workspace/post-analysis/worker.ts';
import { BusinessAnalysisRepository } from '../workspace/persistence/businessAnalysisRepository.ts';
import { AudioExecutionRepository } from '../workspace/persistence/audioExecutionRepository.ts';
import { SalesAnalysisAgent } from '../workspace/business-analysis/salesAnalysisAgent.ts';
import { BusinessAnalysisWorkflow } from '../workspace/business-analysis/workflow.ts';
import { BusinessAnalysisWorker } from '../workspace/business-analysis/worker.ts';

/** 装配完整 RAG 运行时，并返回服务器所需的应用接口、worker 与关闭函数。 */
export function createRagRuntime(config: ApiConfig) {
  const executionReporter = createAiExecutionReporter(config.aiExecutionReports);
  const sttRawResponseReporter = createSttRawResponseReporter({
    enabled: config.aiExecutionReports.includeSttRawResponses,
    outputDirectory: config.aiExecutionReports.outputDirectory,
  });
  const pool = createDatabasePool(config.database);
  const liveUpdates = new LiveUpdateBroker();
  const workerWakeup = new PostgresWorkerWakeup(pool, config.database.schema, config.rag.tenantId);
  const audioExecutionRepository = new AudioExecutionRepository(
    pool,
    config.database.schema,
    config.rag.tenantId,
    liveUpdates,
  );
  const audioExecutionReporter = createCompositeAiExecutionReporter([
    executionReporter,
    audioExecutionRepository.createReporter(),
  ]);
  const knowledgeRepository = new KnowledgeRepository(
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
  const workspaceRepository = new WorkspaceRepository(
    pool,
    config.database.schema,
    config.rag.tenantId,
  );
  const audioAnalysisRepository = new AudioAnalysisRepository(
    pool,
    config.database.schema,
    config.rag.tenantId,
  );
  const postAnalysisRepository = new PostAnalysisRepository(
    pool,
    config.database.schema,
    config.rag.tenantId,
  );
  const businessAnalysisRepository = new BusinessAnalysisRepository(
    pool,
    config.database.schema,
    config.rag.tenantId,
  );
  const transcriptConfirmationRepository = new TranscriptConfirmationRepository(
    pool,
    config.database.schema,
    config.rag.tenantId,
  );
  const audioInputPreprocessor = new AudioInputPreprocessor({
    audioStorageDirectory: config.rag.audioStorageDir,
    tempDirectory: config.rag.audioTranscriptionTempDir,
    ...(config.rag.ffmpegPath ? { ffmpegPath: config.rag.ffmpegPath } : {}),
    defaultModel: config.rag.audioTranscriptionModel,
    transcriptionConfigured: Boolean(config.rag.dashScope.oss),
  });
  const embeddings = new DashScopeEmbeddings({
    apiKey: config.rag.dashScope.apiKey,
    baseUrl: config.rag.dashScope.baseUrl,
    model: config.rag.embeddingModel,
    dimensions: config.rag.embeddingDimensions,
  });
  const checkpointer = PostgresSaver.fromConnString(
    createPostgresConnectionString(config.database),
    {
      schema: config.rag.langGraphSchema,
    },
  );
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
  const workspaceService = new DefaultWorkspaceService(
    workspaceRepository,
    config.rag.audioStorageDir,
    audioAnalysisRepository,
    config.rag.audioTranscriptionModel,
    audioInputPreprocessor,
    postAnalysisRepository,
    transcriptConfirmationRepository,
    config.rag.audioEmotionModel,
    config.rag.deepSeekChatModel,
    Boolean(config.rag.dashScope.oss),
    businessAnalysisRepository,
    audioExecutionRepository,
  );
  const dashScope = new DashScopeFileTranscription(
    config.rag.dashScope.apiKey,
    config.rag.dashScope.baseUrl,
    fetch,
    (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs)),
    sttRawResponseReporter,
  );
  const ossStaging = config.rag.dashScope.oss
    ? new OssStagingStore({
        region: config.rag.dashScope.oss.region,
        bucket: config.rag.dashScope.oss.bucket,
        accessKeyId: config.rag.dashScope.oss.accessKeyId,
        accessKeySecret: config.rag.dashScope.oss.accessKeySecret,
        tenantId: config.rag.tenantId,
      })
    : undefined;
  const transcriptionWorker = new AudioTranscriptionWorker({
    repository: audioAnalysisRepository,
    dashScope,
    maxInFlight: config.rag.audioTranscriptionMaxInFlight,
    notifyMode: config.rag.dashScope.asyncNotifyMode,
    preprocessor: audioInputPreprocessor,
    reporter: audioExecutionReporter,
    liveUpdates,
    wakeup: workerWakeup,
    ...(ossStaging ? { ossStaging } : {}),
  });
  const dashScopeCallbackService =
    config.rag.dashScope.asyncNotifyMode === 'eventbridge' &&
    config.rag.dashScope.eventBridgeCallback
      ? new DashScopeCallbackService({
          repository: audioAnalysisRepository,
          signatureVerifier: new EventBridgeSignatureVerifier({
            callbackUrl: config.rag.dashScope.eventBridgeCallback.url,
            token: config.rag.dashScope.eventBridgeCallback.token,
          }),
          rawResponseReporter: sttRawResponseReporter,
        })
      : undefined;
  const audioWindowPreprocessor = new AudioWindowPreprocessor({
    audioStorageDirectory: config.rag.audioStorageDir,
    tempDirectory: config.rag.audioTranscriptionTempDir,
    ...(config.rag.ffmpegPath ? { ffmpegPath: config.rag.ffmpegPath } : {}),
  });
  const emotionWorker = new AudioPostAnalysisWorker({
    type: 'emotion',
    repository: postAnalysisRepository,
    preprocessor: audioWindowPreprocessor,
    reporter: audioExecutionReporter,
    liveUpdates,
    wakeup: workerWakeup,
    emotionAnalyzer: new QwenEmotionAnalyzer({
      apiKey: config.rag.dashScope.apiKey,
      baseUrl: config.rag.dashScope.compatibleBaseUrl,
      model: config.rag.audioEmotionModel,
    }),
    ...(ossStaging ? { ossStaging } : {}),
  });
  const roleWorker = new AudioPostAnalysisWorker({
    type: 'role',
    repository: postAnalysisRepository,
    reporter: audioExecutionReporter,
    liveUpdates,
    wakeup: workerWakeup,
    roleRecognizer: new DeepSeekRoleRecognizer({
      apiKey: config.rag.deepSeekApiKey,
      baseUrl: config.rag.deepSeekBaseUrl,
      model: config.rag.deepSeekChatModel,
    }),
  });
  const businessAnalysisWorkflow = new BusinessAnalysisWorkflow({
    repository: businessAnalysisRepository,
    knowledgeRepository,
    embeddings,
    embeddingModel: config.rag.embeddingModel,
    agent: new SalesAnalysisAgent({ ragConfig: config.rag }),
    checkpointer,
  });
  const businessAnalysisWorker = new BusinessAnalysisWorker({
    repository: businessAnalysisRepository,
    workflow: businessAnalysisWorkflow,
    reporter: audioExecutionReporter,
    liveUpdates,
    wakeup: workerWakeup,
  });
  return {
    service,
    workspaceService,
    worker,
    transcriptionWorker,
    dashScopeCallbackService,
    emotionWorker,
    roleWorker,
    businessAnalysisWorker,
    audioInputPreprocessor,
    liveUpdates,
    workerWakeup,
    async close() {
      await answers.dispose();
      await transcriptionWorker.stop();
      await Promise.all([emotionWorker.stop(), roleWorker.stop(), businessAnalysisWorker.stop()]);
      await worker.stop();
      await workerWakeup.close();
      await checkpointer.end();
      await pool.end();
    },
  };
}
