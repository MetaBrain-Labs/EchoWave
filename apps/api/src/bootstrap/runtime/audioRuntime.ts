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
import { DashScopeEmbeddings } from '../../knowledge/embeddings/dashScopeEmbeddings.ts';
import type { KnowledgeSearchPort } from '../../knowledge/retrieval/port.ts';
import type { SettingsService } from '../../settings/service.ts';
import { BusinessAnalysisWorker } from '../../workspace/audio/business-analysis/worker.ts';
import { SalesAnalysisAgent } from '../../workspace/audio/business-analysis/salesAnalysisAgent.ts';
import {
  BusinessAnalysisWorkflow,
  businessAnalysisThreadId,
} from '../../workspace/audio/business-analysis/workflow.ts';
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
import {
  DashScopeCallbackError,
  DashScopeCallbackService,
} from '../../workspace/audio/transcription/dashScopeCallback.ts';
import { DashScopeFileTranscription } from '../../workspace/audio/transcription/dashScopeFileTranscription.ts';
import { EventBridgeSignatureVerifier } from '../../workspace/audio/transcription/eventBridgeSignature.ts';
import { OssStagingStore } from '../../workspace/audio/transcription/ossStagingStore.ts';
import { AudioTranscriptionWorker } from '../../workspace/audio/transcription/worker.ts';

type AudioRuntimeOptions = {
  config: ApiConfig;
  pool: DatabasePool;
  liveUpdates: LiveUpdateBroker;
  workerWakeup: WorkerWakeupSource;
  checkpointer: PostgresSaver;
  knowledgeSearch: KnowledgeSearchPort;
  audioCoreRepository: AudioCoreRepository;
  audioExecutionRepository: PostgresAudioExecutionRepository;
  reporter: AiExecutionReporter;
  sttRawResponseReporter: SttRawResponseReporter;
  settingsService: SettingsService;
};

/** 创建音频应用服务、供应商适配器与全部音频 Worker。 */
export function createAudioRuntime(options: AudioRuntimeOptions) {
  const {
    config,
    pool,
    liveUpdates,
    workerWakeup,
    checkpointer,
    knowledgeSearch,
    audioCoreRepository,
    audioExecutionRepository,
    reporter,
    sttRawResponseReporter,
    settingsService,
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
  });
  const audioService = new DefaultAudioService(
    audioCoreRepository,
    config.rag.audioStorageDir,
    audioAnalysisRepository,
    config.rag.audioTranscriptionModel,
    audioInputPreprocessor,
    postAnalysisRepository,
    transcriptConfirmationRepository,
    settingsService,
    businessAnalysisRepository,
    audioExecutionRepository,
  );
  const transcriptionWorker = new AudioTranscriptionWorker({
    repository: audioAnalysisRepository,
    maxInFlight: config.rag.audioTranscriptionMaxInFlight,
    resolveProviders: async (job) => {
      const [transcription, staging] = await Promise.all([
        settingsService.resolveCapability(
          'audio_transcription',
          job.transcriptionBindingRevisionId ?? undefined,
        ),
        settingsService.resolveCapability(
          'audio_staging',
          job.stagingBindingRevisionId ?? undefined,
        ),
      ]);
      if (
        transcription.provider.type !== 'dashscope' ||
        !('apiKey' in transcription.provider.credential) ||
        staging.provider.type !== 'aliyun_oss' ||
        !('accessKeyId' in staging.provider.credential)
      ) {
        throw new Error('Resolved audio transcription providers are incompatible.');
      }
      const transcriptionConfig = transcription.provider.config as {
        baseUrl: string;
        asyncNotifyMode: 'polling' | 'eventbridge';
      };
      const stagingConfig = staging.provider.config as { region: string; bucket: string };
      return {
        dashScope: new DashScopeFileTranscription(
          transcription.provider.credential.apiKey,
          transcriptionConfig.baseUrl,
          fetch,
          (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs)),
          sttRawResponseReporter,
        ),
        notifyMode: transcriptionConfig.asyncNotifyMode,
        ossStaging: new OssStagingStore({
          region: stagingConfig.region,
          bucket: stagingConfig.bucket,
          accessKeyId: staging.provider.credential.accessKeyId,
          accessKeySecret: staging.provider.credential.accessKeySecret,
          tenantId: config.rag.tenantId,
        }),
      };
    },
    preprocessor: audioInputPreprocessor,
    reporter,
    liveUpdates,
    wakeup: workerWakeup,
  });
  const dashScopeCallbackService = new DashScopeCallbackService({
    repository: audioAnalysisRepository,
    resolveSignatureVerifier: async (taskId) => {
      const revisionId = await audioAnalysisRepository.findTranscriptionBindingByTaskId(taskId);
      if (revisionId === undefined) {
        throw new DashScopeCallbackError('unauthorized', 'Unknown callback task.');
      }
      const resolved = await settingsService.resolveCapability(
        'audio_transcription',
        revisionId ?? undefined,
      );
      if (
        resolved.provider.type !== 'dashscope' ||
        !('eventBridgeCallbackToken' in resolved.provider.credential) ||
        !resolved.provider.credential.eventBridgeCallbackToken
      ) {
        throw new DashScopeCallbackError('temporary_unavailable', 'Callback token unavailable.');
      }
      const providerConfig = resolved.provider.config as { eventBridgeCallbackUrl: string | null };
      if (!providerConfig.eventBridgeCallbackUrl) {
        throw new DashScopeCallbackError('temporary_unavailable', 'Callback URL unavailable.');
      }
      return new EventBridgeSignatureVerifier({
        callbackUrl: providerConfig.eventBridgeCallbackUrl,
        token: resolved.provider.credential.eventBridgeCallbackToken,
      });
    },
    rawResponseReporter: sttRawResponseReporter,
  });
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
    resolveRuntime: async (job) => {
      const [emotion, staging] = await Promise.all([
        settingsService.resolveCapability(
          'audio_emotion',
          job.capabilityBindingRevisionId ?? undefined,
        ),
        settingsService.resolveCapability(
          'audio_staging',
          job.stagingBindingRevisionId ?? undefined,
        ),
      ]);
      if (
        emotion.provider.type !== 'dashscope' ||
        !('apiKey' in emotion.provider.credential) ||
        staging.provider.type !== 'aliyun_oss' ||
        !('accessKeyId' in staging.provider.credential)
      ) {
        throw new Error('Resolved emotion analysis providers are incompatible.');
      }
      const stagingConfig = staging.provider.config as { region: string; bucket: string };
      return {
        emotionAnalyzer: new QwenEmotionAnalyzer({
          apiKey: emotion.provider.credential.apiKey,
          baseUrl: (emotion.provider.config as { compatibleBaseUrl: string }).compatibleBaseUrl,
          model: job.model,
        }),
        ossStaging: new OssStagingStore({
          region: stagingConfig.region,
          bucket: stagingConfig.bucket,
          accessKeyId: staging.provider.credential.accessKeyId,
          accessKeySecret: staging.provider.credential.accessKeySecret,
          tenantId: config.rag.tenantId,
        }),
      };
    },
  });
  const roleWorker = new AudioPostAnalysisWorker({
    type: 'role',
    repository: postAnalysisRepository,
    reporter,
    liveUpdates,
    wakeup: workerWakeup,
    resolveRuntime: async (job) => {
      const role = await settingsService.resolveCapability(
        'audio_role',
        job.capabilityBindingRevisionId ?? undefined,
      );
      if (role.provider.type !== 'deepseek' || !('apiKey' in role.provider.credential)) {
        throw new Error('Resolved role analysis provider is incompatible.');
      }
      return {
        roleRecognizer: new DeepSeekRoleRecognizer({
          apiKey: role.provider.credential.apiKey,
          baseUrl: (role.provider.config as { baseUrl: string }).baseUrl,
          model: job.model,
        }),
      };
    },
  });
  const businessAnalysisWorker = new BusinessAnalysisWorker({
    repository: businessAnalysisRepository,
    deleteCheckpoint: (job) => checkpointer.deleteThread(businessAnalysisThreadId(job)),
    createWorkflow: async (job) => {
      const [chat, embedding] = await Promise.all([
        settingsService.resolveCapability(
          'business_analysis',
          job.chatBindingRevisionId ?? undefined,
        ),
        settingsService.resolveCapability(
          'knowledge_embedding',
          job.embeddingBindingRevisionId ?? undefined,
        ),
      ]);
      if (
        chat.provider.type !== 'deepseek' ||
        !('apiKey' in chat.provider.credential) ||
        embedding.provider.type !== 'dashscope' ||
        !('apiKey' in embedding.provider.credential)
      ) {
        throw new Error('Resolved business analysis providers are incompatible.');
      }
      const dynamicRagConfig = {
        ...config.rag,
        deepSeekApiKey: chat.provider.credential.apiKey,
        deepSeekBaseUrl: (chat.provider.config as { baseUrl: string }).baseUrl,
        deepSeekChatModel: job.model as typeof config.rag.deepSeekChatModel,
        enableThinking: chat.settings.enableThinking === true,
        embeddingModel: embedding.model as typeof config.rag.embeddingModel,
      };
      return new BusinessAnalysisWorkflow({
        repository: businessAnalysisRepository,
        knowledgeRepository: knowledgeSearch,
        embeddings: new DashScopeEmbeddings({
          apiKey: embedding.provider.credential.apiKey,
          baseUrl: (embedding.provider.config as { baseUrl: string }).baseUrl,
          model: embedding.model,
          dimensions: 1024,
        }),
        embeddingModel: embedding.model,
        agent: new SalesAnalysisAgent({ ragConfig: dynamicRagConfig }),
        checkpointer,
      });
    },
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
