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
import type {
  AudioAiExecutionStreamEvent,
  AudioAiExecutionTraceResponse,
  AudioAnalysisDetail,
  AudioBusinessAnalysisStartRequest,
  AudioBusinessAnalysisStartResponse,
  AudioPostAnalysisStartResponse,
  AudioPostAnalysisType,
  AudioTranscriptConfirmationRequest,
  AudioTranscriptConfirmationResponse,
  AudioTranscriptionCapabilitiesResponse,
  AudioTranscriptionModel,
  AudioTranscriptionStartRequest,
  AudioTranscriptionStartResponse,
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

/** HTTP 音频流接口可读取的本地文件描述。 */
export type AudioPlaybackFile = {
  absolutePath: string;
  lastModified: Date;
  mimeType: string;
  originalFilename: string;
  sizeBytes: number;
};

/** 音频路由依赖的应用服务端口。 */
export interface AudioService {
  getAudioPlaybackFile(id: string): Promise<AudioPlaybackFile>;
  getAudioTranscriptionCapabilities(): AudioTranscriptionCapabilitiesResponse;
  startAudioTranscription(
    id: string,
    input: AudioTranscriptionStartRequest,
  ): Promise<AudioTranscriptionStartResponse>;
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
  startAudioPostAnalysis(
    id: string,
    type: AudioPostAnalysisType,
  ): Promise<AudioPostAnalysisStartResponse>;
  startAudioBusinessAnalysis(
    id: string,
    input: AudioBusinessAnalysisStartRequest,
  ): Promise<AudioBusinessAnalysisStartResponse>;
}

/** 组合音频读取和各分析生命周期 Repository 的默认服务。 */
export class DefaultAudioService implements AudioService {
  constructor(
    private readonly repository: AudioCoreRepository,
    private readonly audioStorageDirectory: string,
    private readonly audioAnalysisRepository: AudioAnalysisRepository,
    private readonly audioTranscriptionModel: AudioTranscriptionModel,
    private readonly audioInputPreprocessor: AudioInputPreprocessor,
    private readonly postAnalysisRepository: PostAnalysisRepository,
    private readonly transcriptConfirmationRepository: TranscriptConfirmationRepository,
    private readonly audioEmotionModel: 'qwen3.5-omni-flash',
    private readonly roleModel: 'deepseek-v4-flash',
    private readonly emotionProviderConfigured: boolean,
    private readonly businessAnalysisRepository?: BusinessAnalysisRepository,
    private readonly audioExecutionRepository?: AudioExecutionQuery,
  ) {}

  /** 将租户内存储键解析为受控的实际音频文件，拒绝越界路径和缺失文件。 */
  async getAudioPlaybackFile(id: string): Promise<AudioPlaybackFile> {
    const source = await this.repository.getAudioPlaybackSource(id);
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

  getAudioTranscriptionCapabilities() {
    return this.audioInputPreprocessor.capabilities();
  }

  async startAudioTranscription(id: string, input: AudioTranscriptionStartRequest) {
    const model = input.model ?? this.audioTranscriptionModel;
    const preprocessing = input.preprocessing ?? 'whole_file';
    if (!(await this.audioInputPreprocessor.refreshModeAvailability(preprocessing))) {
      const capabilities = this.audioInputPreprocessor.capabilities();
      throw new WorkspaceRepositoryError(
        'TRANSCODER_UNAVAILABLE',
        preprocessing === 'silero_vad'
          ? (capabilities.sileroVad.unavailableReason ?? 'Silero VAD 当前不可用。')
          : 'FFmpeg 当前不可用，无法生成说话人分离所需的单声道整文件。',
      );
    }
    const refreshedCapability = this.audioInputPreprocessor
      .capabilities()
      .models.find((candidate) => candidate.id === model)!;
    if (!refreshedCapability.available) {
      throw new WorkspaceRepositoryError(
        'CONFLICT',
        refreshedCapability.unavailableReason ?? '所选转写模型当前不可用。',
      );
    }
    return await this.audioAnalysisRepository.queueTranscription(
      id,
      model,
      preprocessing,
      input.segmentationMode ?? 'speaker_turn',
    );
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

  /** 校验情绪分析运行依赖后，为当前 ASR 修订创建指定后置任务。 */
  async startAudioPostAnalysis(id: string, type: AudioPostAnalysisType) {
    if (type === 'emotion') {
      const ffmpegAvailable = await this.audioInputPreprocessor.refreshFfmpegAvailability();
      if (!this.emotionProviderConfigured || !ffmpegAvailable) {
        throw new WorkspaceRepositoryError(
          'CONFLICT',
          '情绪分析所需的 Qwen、北京地域 OSS 或 FFmpeg 尚未完整配置。',
        );
      }
    }
    return this.postAnalysisRepository.queue(
      id,
      type,
      type === 'emotion' ? this.audioEmotionModel : this.roleModel,
    );
  }

  startAudioBusinessAnalysis(id: string, input: AudioBusinessAnalysisStartRequest) {
    if (!this.businessAnalysisRepository) {
      throw new WorkspaceRepositoryError('CONFLICT', '业务分析服务尚未配置。');
    }
    return this.businessAnalysisRepository.queue(id, input.groupId, this.roleModel, input.force);
  }
}
