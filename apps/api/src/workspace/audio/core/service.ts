/**
 * 音频领域服务端口。
 *
 * 定义播放、转写、分析详情和执行实时流所需能力。
 *
 * Responsibilities:
 * - 为音频 HTTP 路由提供显式稳定类型。
 * - 隔离传输层与各生命周期 Repository。
 *
 * Notes:
 * - Worker 生命周期不通过本端口暴露。
 */
import {
  AUDIO_TRANSCRIPTION_MODEL_CAPABILITIES,
  AudioTranscriptionCapabilitiesResponseSchema,
  AudioTranscriptionStartRequestSchema,
  type AudioAiExecutionStreamEvent,
  type AudioAiExecutionTraceResponse,
  type AudioAnalysisDetail,
  type AudioBusinessAnalysisStartRequest,
  type AudioBusinessAnalysisStartResponse,
  type AudioPostAnalysisStartResponse,
  type AudioPostAnalysisType,
  type SpeakerReviewResolutionResponse,
  type AudioTranscriptConfirmationRequest,
  type AudioTranscriptConfirmationResponse,
  type AudioTranscriptionCapabilitiesResponse,
  type AudioTranscriptionModel,
  type AudioTranscriptionStartRequest,
  type SupportedLanguage,
  type AudioTranscriptionStartResponse,
} from '@echowave/contracts';
import { stat } from 'node:fs/promises';
import path from 'node:path';

import type { AudioInputPreprocessor } from '../transcription/audioPreprocessor.ts';
import type { AudioAnalysisRepository } from '../transcription/repository.ts';
import type { AudioExecutionQuery } from '../execution/repository.ts';
import type { BusinessAnalysisRepository } from '../business-analysis/repository.ts';
import { WorkspaceRepositoryError } from '../../errors.ts';
import type { PostAnalysisRepository } from '../post-analysis/repository.ts';
import type { TranscriptConfirmationRepository } from './transcriptConfirmationRepository.ts';
import type { AudioCoreRepository } from './repository.ts';
import type { SettingsService } from '../../../settings/service.ts';
import { SettingsError } from '../../../settings/types.ts';
import { PrimaryOssStore } from '../runtime-mode/primaryOssStore.ts';

/** HTTP 音频流接口可读取的本地文件描述。 */
export type AudioPlaybackFile = {
  kind: 'local' | 'remote';
  absolutePath?: string;
  remoteUrl?: string;
  lastModified: Date;
  mimeType: string;
  originalFilename: string;
  sizeBytes: number;
};

/** 自动批次冻结后传给阶段创建方法的能力引用。 */
export type FrozenAudioCapabilityBindings = {
  transcription?: string | null;
  staging?: string | null;
  emotion?: string | null;
  role?: string | null;
  businessAnalysis?: string | null;
  knowledgeEmbedding?: string | null;
};

/** 自动业务分析冻结的分组输入。 */
export type FrozenBusinessAnalysisInput = {
  analysisTiming: 'automatic' | 'manual';
  contentFocus: string;
  tone: string;
  customTags: string[];
  knowledgeBaseIds: string[];
};

/** 音频路由依赖的应用服务端口。 */
export interface AudioService {
  getAudioPlaybackFile(id: string): Promise<AudioPlaybackFile>;
  getAudioTranscriptionCapabilities(): Promise<AudioTranscriptionCapabilitiesResponse>;
  startAudioTranscription(
    id: string,
    input: AudioTranscriptionStartRequest,
    frozenBindings?: FrozenAudioCapabilityBindings,
  ): Promise<AudioTranscriptionStartResponse>;
  listAudioTranscriptions(id: string): ReturnType<AudioAnalysisRepository['listTranscriptions']>;
  selectAudioTranscription(
    id: string,
    input: unknown,
  ): ReturnType<AudioAnalysisRepository['selectTranscription']>;
  getAudioAnalysis(id: string, groupId?: string): Promise<AudioAnalysisDetail>;
  getAudioExecutionTrace(id: string, groupId?: string): Promise<AudioAiExecutionTraceResponse>;
  getAudioExecutionStreamSnapshot(
    id: string,
    groupId?: string,
  ): Promise<AudioAiExecutionStreamEvent>;
  getAudioExecutionStreamEvents(
    id: string,
    revisionId: string,
    groupId: string | undefined,
    cursor: string,
  ): Promise<AudioAiExecutionStreamEvent[]>;
  confirmAudioTranscript(
    id: string,
    input: AudioTranscriptConfirmationRequest,
  ): Promise<AudioTranscriptConfirmationResponse>;
  ensureSystemRawTranscriptSnapshot(id: string, revisionId: string): Promise<string>;
  resolveSpeakerReviewFinding(
    id: string,
    findingId: string,
  ): Promise<SpeakerReviewResolutionResponse>;
  resolveAllSpeakerReviewFindings(id: string): Promise<SpeakerReviewResolutionResponse>;
  startAudioPostAnalysis(
    id: string,
    type: AudioPostAnalysisType,
    frozenBindings?: FrozenAudioCapabilityBindings,
    language?: SupportedLanguage,
  ): Promise<AudioPostAnalysisStartResponse>;
  startAudioBusinessAnalysis(
    id: string,
    input: AudioBusinessAnalysisStartRequest,
    frozenBindings?: FrozenAudioCapabilityBindings,
    frozenInput?: FrozenBusinessAnalysisInput,
  ): Promise<AudioBusinessAnalysisStartResponse>;
}

/** 组合音频读取和各分析生命周期 Repository 的默认服务。 */
export class DefaultAudioService implements AudioService {
  private readonly settingsService: Pick<SettingsService, 'resolveCapability'>;
  private readonly businessAnalysisRepository?: BusinessAnalysisRepository;
  private readonly audioExecutionRepository?: AudioExecutionQuery;

  constructor(
    private readonly repository: AudioCoreRepository,
    private readonly audioStorageDirectory: string,
    private readonly audioAnalysisRepository: AudioAnalysisRepository,
    private readonly audioTranscriptionModel: AudioTranscriptionModel,
    private readonly audioInputPreprocessor: AudioInputPreprocessor,
    private readonly postAnalysisRepository: PostAnalysisRepository,
    private readonly transcriptConfirmationRepository: TranscriptConfirmationRepository,
    settingsOrEmotionModel?: Pick<SettingsService, 'resolveCapability'> | string,
    roleModelOrBusinessRepository?: string | BusinessAnalysisRepository,
    stagingOrExecutionRepository?: boolean | AudioExecutionQuery,
    legacyBusinessAnalysisRepository?: BusinessAnalysisRepository,
    legacyAudioExecutionRepository?: AudioExecutionQuery,
  ) {
    if (
      settingsOrEmotionModel &&
      typeof settingsOrEmotionModel === 'object' &&
      'resolveCapability' in settingsOrEmotionModel
    ) {
      this.settingsService = settingsOrEmotionModel;
      this.businessAnalysisRepository = roleModelOrBusinessRepository as
        BusinessAnalysisRepository | undefined;
      this.audioExecutionRepository = stagingOrExecutionRepository as
        AudioExecutionQuery | undefined;
      return;
    }
    const emotionModel = settingsOrEmotionModel ?? 'qwen3.5-omni-flash';
    const roleModel =
      typeof roleModelOrBusinessRepository === 'string'
        ? roleModelOrBusinessRepository
        : 'deepseek-v4-flash';
    const stagingConfigured =
      typeof stagingOrExecutionRepository === 'boolean' ? stagingOrExecutionRepository : true;
    this.businessAnalysisRepository = legacyBusinessAnalysisRepository;
    this.audioExecutionRepository = legacyAudioExecutionRepository;
    this.settingsService = {
      resolveCapability: async (capability) => {
        if (capability === 'audio_staging' && !stagingConfigured) {
          throw new WorkspaceRepositoryError('CONFLICT', '临时 OSS 尚未配置。');
        }
        return {
          revisionId: null,
          model:
            capability === 'audio_emotion'
              ? emotionModel
              : capability === 'audio_role' || capability === 'business_analysis'
                ? roleModel
                : capability === 'knowledge_embedding'
                  ? 'qwen3.7-text-embedding'
                  : capability === 'audio_staging'
                    ? 'aliyun-oss'
                    : this.audioTranscriptionModel,
          settings: {},
          provider: {
            type: capability === 'audio_staging' ? 'aliyun_oss' : 'dashscope',
            config: { asyncNotifyMode: 'polling' },
            credential:
              capability === 'audio_staging'
                ? {
                    accessKeyId: 'legacy-test-access-key-id',
                    accessKeySecret: 'legacy-test-access-key-secret',
                  }
                : { apiKey: 'legacy-test-placeholder' },
          },
        } as Awaited<ReturnType<SettingsService['resolveCapability']>>;
      },
    };
  }

  /** 将租户内存储键解析为受控的实际音频文件，拒绝越界路径和缺失文件。 */
  async getAudioPlaybackFile(id: string): Promise<AudioPlaybackFile> {
    const source = await this.repository.getAudioPlaybackSource(id);
    if (source.storageBackend === 'aliyun_oss') {
      const primary = await this.settingsService.resolveCapability(
        'audio_primary_storage',
        source.storageBindingRevisionId ?? undefined,
      );
      if (
        primary.provider.type !== 'aliyun_oss' ||
        !('accessKeyId' in primary.provider.credential)
      ) {
        throw new WorkspaceRepositoryError('CONFLICT', '权威音频对象存储配置不兼容。');
      }
      const config = primary.provider.config as { bucket: string; region: string };
      const store = new PrimaryOssStore({
        accessKeyId: primary.provider.credential.accessKeyId,
        accessKeySecret: primary.provider.credential.accessKeySecret,
        bucket: config.bucket,
        region: config.region,
        tenantId: 'playback',
      });
      return {
        kind: 'remote',
        remoteUrl: store.signedGetUrl(source.storageKey),
        lastModified: source.updatedAt,
        mimeType: source.mimeType,
        originalFilename: source.originalFilename,
        sizeBytes: source.sizeBytes,
      };
    }
    const root = path.resolve(this.audioStorageDirectory);
    const absolutePath = path.resolve(root, source.storageKey);
    if (!absolutePath.startsWith(`${root}${path.sep}`)) {
      throw new WorkspaceRepositoryError('NOT_FOUND', '音频文件不存在。');
    }
    try {
      const details = await stat(absolutePath);
      if (!details.isFile() || details.size <= 0) {
        throw new WorkspaceRepositoryError('NOT_FOUND', '音频文件不存在。');
      }
      return {
        kind: 'local',
        absolutePath,
        lastModified: details.mtime,
        mimeType: source.mimeType,
        originalFilename: source.originalFilename,
        sizeBytes: details.size,
      };
    } catch (error) {
      if (error instanceof WorkspaceRepositoryError) throw error;
      throw new WorkspaceRepositoryError('NOT_FOUND', '音频文件不存在。');
    }
  }

  async getAudioTranscriptionCapabilities() {
    const local = this.audioInputPreprocessor.capabilities();
    let transcriptionConfigured = false;
    try {
      const [transcription, staging] = await Promise.all([
        this.settingsService.resolveCapability('audio_transcription'),
        this.settingsService.resolveCapability('audio_staging'),
      ]);
      transcriptionConfigured =
        transcription.provider.type === 'dashscope' &&
        'apiKey' in transcription.provider.credential &&
        staging.provider.type === 'aliyun_oss' &&
        'accessKeyId' in staging.provider.credential;
    } catch (error) {
      if (!(error instanceof SettingsError) || error.code !== 'CONFIGURATION_REQUIRED') throw error;
    }
    const available = transcriptionConfigured && local.ffmpeg.available;
    return AudioTranscriptionCapabilitiesResponseSchema.parse({
      defaultModel: this.audioTranscriptionModel,
      models: AUDIO_TRANSCRIPTION_MODEL_CAPABILITIES.map((model) => ({
        ...model,
        available,
        unavailableReason: available
          ? null
          : !transcriptionConfigured
            ? '请先在 AI 配置中绑定 DashScope 转写和阿里云 OSS 临时存储。'
            : '服务端 FFmpeg 不可用，无法生成说话人分离所需的单声道整文件。',
      })),
      ffmpeg: local.ffmpeg,
      sileroVad: local.sileroVad,
      transcriptionConfigured,
    });
  }

  async startAudioTranscription(
    id: string,
    input: AudioTranscriptionStartRequest,
    frozenBindings?: FrozenAudioCapabilityBindings,
  ) {
    const request = AudioTranscriptionStartRequestSchema.parse(input);
    const assetRuntime = await this.audioAnalysisRepository.getAssetRuntime(id);
    const transcription = await this.settingsService.resolveCapability(
      'audio_transcription',
      frozenBindings?.transcription ?? undefined,
    );
    const staging =
      assetRuntime.mode === 'lightweight_local'
        ? undefined
        : await this.settingsService.resolveCapability(
            'audio_staging',
            frozenBindings?.staging ?? undefined,
          );
    if (
      transcription.provider.type !== 'dashscope' ||
      !('apiKey' in transcription.provider.credential) ||
      (staging &&
        (staging.provider.type !== 'aliyun_oss' || !('accessKeyId' in staging.provider.credential)))
    ) {
      throw new WorkspaceRepositoryError('CONFLICT', '音频转写能力绑定与供应商类型不兼容。');
    }
    const includeAcousticEmotion =
      assetRuntime.mode === 'lightweight_local' && request.includeAcousticEmotion;
    const emotion = includeAcousticEmotion
      ? await this.settingsService.resolveCapability(
          'audio_emotion',
          frozenBindings?.emotion ?? undefined,
        )
      : undefined;
    if (
      emotion &&
      (emotion.provider.type !== 'dashscope' || !('apiKey' in emotion.provider.credential))
    ) {
      throw new WorkspaceRepositoryError('CONFLICT', '声学情绪能力绑定与供应商类型不兼容。');
    }
    const model = (request.model ?? transcription.model) as AudioTranscriptionModel;
    let speakerReview: Awaited<ReturnType<SettingsService['resolveCapability']>> | undefined;
    try {
      speakerReview = await this.settingsService.resolveCapability('audio_speaker_review');
    } catch (error) {
      if (!(error instanceof SettingsError) || error.code !== 'CONFIGURATION_REQUIRED') throw error;
    }
    const preprocessing = request.preprocessing;
    if (!(await this.audioInputPreprocessor.refreshModeAvailability(preprocessing))) {
      const capabilities = this.audioInputPreprocessor.capabilities();
      throw new WorkspaceRepositoryError(
        'TRANSCODER_UNAVAILABLE',
        preprocessing === 'silero_vad'
          ? (capabilities.sileroVad.unavailableReason ?? 'Silero VAD 当前不可用。')
          : 'FFmpeg 当前不可用，无法生成说话人分离所需的单声道整文件。',
      );
    }
    const segmentationMode = request.segmentationMode;
    return await this.audioAnalysisRepository.queueTranscription(
      id,
      model,
      preprocessing,
      segmentationMode,
      request.expectedSpeakerCount ?? null,
      transcription.revisionId,
      staging?.revisionId ?? null,
      speakerReview?.revisionId ?? null,
      speakerReview?.model ?? null,
      (transcription.provider.config as { asyncNotifyMode: 'polling' | 'eventbridge' })
        .asyncNotifyMode,
      includeAcousticEmotion,
      emotion?.revisionId ?? null,
      emotion?.model ?? null,
      request.language,
    );
  }

  listAudioTranscriptions(id: string) {
    return this.audioAnalysisRepository.listTranscriptions(id);
  }

  selectAudioTranscription(id: string, input: unknown) {
    return this.audioAnalysisRepository.selectTranscription(id, input);
  }

  async getAudioAnalysis(id: string, groupId?: string) {
    const detail = await this.repository.getAudioAnalysis(id);
    if (!groupId) return detail;
    await this.repository.assertGroupAudioAccess(groupId, id);
    if (detail.transcriptConfirmation.status !== 'confirmed') return detail;
    if (!this.businessAnalysisRepository) {
      throw new WorkspaceRepositoryError('CONFLICT', '业务分析服务尚未配置。');
    }
    return {
      ...detail,
      businessAnalysis: await this.businessAnalysisRepository.getState(id, groupId),
    };
  }

  /** 读取当前已发布修订的安全执行轨迹，并复用分组音频访问边界。 */
  async getAudioExecutionTrace(id: string, groupId?: string) {
    const detail = await this.repository.getAudioAnalysis(id);
    if (groupId) await this.repository.assertGroupAudioAccess(groupId, id);
    if (!this.audioExecutionRepository) {
      throw new WorkspaceRepositoryError('CONFLICT', '模型执行轨迹服务尚未配置。');
    }
    return this.audioExecutionRepository.getTrace(id, detail.id, groupId);
  }

  /** 校验音频访问后返回 SSE 首帧快照与当前游标。 */
  async getAudioExecutionStreamSnapshot(id: string, groupId?: string) {
    const detail = await this.repository.getAudioAnalysis(id);
    if (groupId) await this.repository.assertGroupAudioAccess(groupId, id);
    if (!this.audioExecutionRepository) {
      throw new WorkspaceRepositoryError('CONFLICT', '模型执行轨迹服务尚未配置。');
    }
    return this.audioExecutionRepository.getStreamSnapshot(id, detail.id, groupId);
  }

  /** 在已经完成首帧访问校验的 SSE 连接中读取后续有界增量。 */
  getAudioExecutionStreamEvents(
    id: string,
    revisionId: string,
    groupId: string | undefined,
    cursor: string,
  ) {
    if (!this.audioExecutionRepository) {
      throw new WorkspaceRepositoryError('CONFLICT', '模型执行轨迹服务尚未配置。');
    }
    return this.audioExecutionRepository.getStreamEvents(id, revisionId, groupId, cursor);
  }

  confirmAudioTranscript(id: string, input: AudioTranscriptConfirmationRequest) {
    return this.transcriptConfirmationRepository.confirm(id, input);
  }

  /** 供服务端自动流水线创建可审计的系统 Raw Transcript 快照。 */
  ensureSystemRawTranscriptSnapshot(id: string, revisionId: string) {
    return this.transcriptConfirmationRepository.ensureSystemRawSnapshot(id, revisionId);
  }

  /** 将当前分析修订中的单个说话人疑点标记为人工审核通过。 */
  async resolveSpeakerReviewFinding(
    id: string,
    findingId: string,
  ): Promise<SpeakerReviewResolutionResponse> {
    return {
      audioFileId: id,
      resolvedCount: await this.repository.resolveSpeakerReviewFinding(id, findingId),
    };
  }

  /** 将当前分析修订中的全部说话人疑点标记为人工审核通过。 */
  async resolveAllSpeakerReviewFindings(id: string): Promise<SpeakerReviewResolutionResponse> {
    return {
      audioFileId: id,
      resolvedCount: await this.repository.resolveAllSpeakerReviewFindings(id),
    };
  }

  /** 校验情绪分析运行依赖后，为当前 ASR 修订创建指定后置任务。 */
  async startAudioPostAnalysis(
    id: string,
    type: AudioPostAnalysisType,
    frozenBindings?: FrozenAudioCapabilityBindings,
    language: SupportedLanguage = 'zh-CN',
  ) {
    if (type === 'emotion') {
      const assetRuntime = await this.audioAnalysisRepository.getAssetRuntime(id);
      if (assetRuntime.mode === 'lightweight_local') {
        throw new WorkspaceRepositoryError(
          'CONFLICT',
          '轻量本地模式的声学情绪只能在创建 ASR Run 时启用，不能稍后单独补跑。',
        );
      }
    }
    const capability = type === 'emotion' ? 'audio_emotion' : 'audio_role';
    const resolved = await this.settingsService.resolveCapability(
      capability,
      type === 'emotion'
        ? (frozenBindings?.emotion ?? undefined)
        : (frozenBindings?.role ?? undefined),
    );
    let stagingRevisionId: string | null = null;
    if (type === 'emotion') {
      const staging = await this.settingsService.resolveCapability(
        'audio_staging',
        frozenBindings?.staging ?? undefined,
      );
      stagingRevisionId = staging.revisionId;
      const ffmpegAvailable = await this.audioInputPreprocessor.refreshFfmpegAvailability();
      if (!ffmpegAvailable) {
        throw new WorkspaceRepositoryError(
          'CONFLICT',
          '情绪分析所需的 Qwen、北京地域 OSS 或 FFmpeg 尚未完整配置。',
        );
      }
    }
    return resolved.revisionId || stagingRevisionId
      ? this.postAnalysisRepository.queue(
          id,
          type,
          resolved.model,
          resolved.revisionId,
          stagingRevisionId,
          language,
        )
      : this.postAnalysisRepository.queue(id, type, resolved.model, null, null, language);
  }

  async startAudioBusinessAnalysis(
    id: string,
    input: AudioBusinessAnalysisStartRequest,
    frozenBindings?: FrozenAudioCapabilityBindings,
    frozenInput?: FrozenBusinessAnalysisInput,
  ) {
    if (!this.businessAnalysisRepository) {
      throw new WorkspaceRepositoryError('CONFLICT', '业务分析服务尚未配置。');
    }
    const [chat, embedding] = await Promise.all([
      this.settingsService.resolveCapability(
        'business_analysis',
        frozenBindings?.businessAnalysis ?? undefined,
      ),
      this.settingsService.resolveCapability(
        'knowledge_embedding',
        frozenBindings?.knowledgeEmbedding ?? undefined,
      ),
    ]);
    return this.businessAnalysisRepository.queue(
      id,
      input.groupId,
      chat.model,
      input.force,
      chat.revisionId,
      embedding.revisionId,
      frozenInput,
      input.language,
    );
  }
}
