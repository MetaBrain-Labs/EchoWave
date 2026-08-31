/**
 * 音频处理 runtime 工厂。
 *
 * 装配转写、后分析、业务分析的 Repository、供应商适配器、Service 与 Worker。
 *
 * Responsibilities:
 * - 创建音频处理各生命周期能力。
 * - 连接业务分析与知识检索端口。
 *
 * Notes:
 * - 共享数据库、checkpoint、报告器和更新 broker 由顶层组合根传入。
 */
import type { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';

import type { AiExecutionReporter } from '../../ai-observability/executionReporter.ts';
import type { SttRawResponseReporter } from '../../ai-observability/sttRawResponseReporter.ts';
import type { ApiConfig } from '../../config/env.ts';
import type { LiveUpdateBroker } from '../../infrastructure/liveUpdateBroker.ts';
import type { DatabasePool } from '../../infrastructure/postgres.ts';
import type { WorkerWakeupSource } from '../../infrastructure/workerWakeup.ts';
import type { DashScopeEmbeddings } from '../../knowledge/embeddings/dashScopeEmbeddings.ts';
import type { KnowledgeSearchPort } from '../../knowledge/retrieval/port.ts';
import { BusinessAnalysisWorker } from '../../workspace/audio/business-analysis/worker.ts';
import { SalesAnalysisAgent } from '../../workspace/audio/business-analysis/salesAnalysisAgent.ts';
import { BusinessAnalysisWorkflow } from '../../workspace/audio/business-analysis/workflow.ts';
import type { AudioCoreRepository } from '../../workspace/audio/core/repository.ts';
import { DefaultAudioService } from '../../workspace/audio/core/service.ts';
import type { PostgresAudioExecutionRepository } from '../../workspace/audio/execution/postgresAudioExecutionRepository.ts';
import { AudioAnalysisRepository } from '../../workspace/audio/transcription/repository.ts';
import { BusinessAnalysisRepository } from '../../workspace/audio/business-analysis/repository.ts';
import { PostAnalysisRepository } from '../../workspace/audio/post-analysis/repository.ts';
import { TranscriptConfirmationRepository } from '../../workspace/audio/core/transcriptConfirmationRepository.ts';
import { AudioWindowPreprocessor } from '../../workspace/audio/post-analysis/audioWindowPreprocessor.ts';
import { DeepSeekRoleRecognizer } from '../../workspace/audio/post-analysis/deepSeekRoleRecognizer.ts';
import { QwenEmotionAnalyzer } from '../../workspace/audio/post-analysis/qwenEmotionAnalyzer.ts';
import { AudioPostAnalysisWorker } from '../../workspace/audio/post-analysis/worker.ts';
import { AudioInputPreprocessor } from '../../workspace/audio/transcription/audioPreprocessor.ts';
import { DashScopeCallbackService } from '../../workspace/audio/transcription/dashScopeCallback.ts';
import { DashScopeFileTranscription } from '../../workspace/audio/transcription/dashScopeFileTranscription.ts';
import { EventBridgeSignatureVerifier } from '../../workspace/audio/transcription/eventBridgeSignature.ts';
import { OssStagingStore } from '../../workspace/audio/transcription/ossStagingStore.ts';
import { AudioTranscriptionWorker } from '../../workspace/audio/transcription/worker.ts';

type AudioRuntimeOptions = {
  config: ApiConfig;
  pool: DatabasePool;
  liveUpdates: LiveUpdateBroker;
  workerWakeup: WorkerWakeupSource;
  embeddings: DashScopeEmbeddings;
  checkpointer: PostgresSaver;
  knowledgeSearch: KnowledgeSearchPort;
  audioCoreRepository: AudioCoreRepository;
  audioExecutionRepository: PostgresAudioExecutionRepository;
  reporter: AiExecutionReporter;
  sttRawResponseReporter: SttRawResponseReporter;
};

/** 创建音频应用服务、供应商适配器与全部音频 Worker。 */
export function createAudioRuntime(options: AudioRuntimeOptions) {
  const {
    config,
    pool,
    liveUpdates,
    workerWakeup,
    embeddings,
    checkpointer,
    knowledgeSearch,
    audioCoreRepository,
    audioExecutionRepository,
    reporter,
    sttRawResponseReporter,
  } = options;
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
  const audioService = new DefaultAudioService(
    audioCoreRepository,
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
    reporter,
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
    reporter,
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
    reporter,
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
    knowledgeRepository: knowledgeSearch,
    embeddings,
    embeddingModel: config.rag.embeddingModel,
    agent: new SalesAnalysisAgent({ ragConfig: config.rag }),
    checkpointer,
  });
  const businessAnalysisWorker = new BusinessAnalysisWorker({
    repository: businessAnalysisRepository,
    workflow: businessAnalysisWorkflow,
    reporter,
    liveUpdates,
    wakeup: workerWakeup,
  });
  return {
    audioService,
    transcriptionWorker,
    dashScopeCallbackService,
    emotionWorker,
    roleWorker,
    businessAnalysisWorker,
    audioInputPreprocessor,
    async stop(): Promise<void> {
      await transcriptionWorker.stop();
      await Promise.all([emotionWorker.stop(), roleWorker.stop(), businessAnalysisWorker.stop()]);
    },
  };
}
