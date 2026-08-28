/**
 * 音频工作区应用服务。
 *
 * 向 HTTP 层暴露分组、数据源、音频上传与分析详情用例。
 *
 * Responsibilities:
 * - 保持传输层与 PostgreSQL 查询实现解耦。
 *
 * Notes:
 * - 本地上传文件由本服务可靠保存；ASR 只在此协调能力检查和任务创建。
 */
import { randomUUID } from 'node:crypto';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { parseBuffer } from 'music-metadata';

import {
  DataSourceCreateRequest,
  DataSourceAudioUploadResponse,
  DataSourceGroupLinkRequest,
  DataSourceUpdateRequest,
  GroupCreateRequest,
  KnowledgeBaseGroupLinkRequest,
  AudioTranscriptionStartRequest,
  AudioTranscriptionModel,
  AudioPostAnalysisType,
  AudioTranscriptConfirmationRequest,
  AudioBusinessAnalysisStartRequest,
  GroupResourceLinksUpdateRequest,
  GroupSettingsUpdateRequest,
} from '@echowave/contracts';

import type { StoredAudioUpload, WorkspaceRepository } from './persistence/workspaceRepository.ts';
import type { AudioAnalysisRepository } from './persistence/audioAnalysisRepository.ts';
import type { PostAnalysisRepository } from './persistence/postAnalysisRepository.ts';
import type { TranscriptConfirmationRepository } from './persistence/transcriptConfirmationRepository.ts';
import type { BusinessAnalysisRepository } from './persistence/businessAnalysisRepository.ts';
import { WorkspaceRepositoryError } from './persistence/errors.ts';
import type { AudioInputPreprocessor } from './transcription/audioPreprocessor.ts';

/** HTTP 音频流接口可读取的本地文件描述。 */
export type AudioPlaybackFile = {
  absolutePath: string;
  lastModified: Date;
  mimeType: string;
  originalFilename: string;
  sizeBytes: number;
};

const MAX_AUDIO_FILES = 20;
const MAX_AUDIO_BYTES = 200 * 1024 * 1024;
const audioMimeTypes: Record<string, Set<string>> = {
  '.mp3': new Set(['audio/mpeg', 'audio/mp3']),
  '.wav': new Set(['audio/wav', 'audio/x-wav', 'audio/wave']),
  '.m4a': new Set(['audio/mp4', 'audio/x-m4a']),
  '.aac': new Set(['audio/aac']),
  '.flac': new Set(['audio/flac', 'audio/x-flac']),
  '.ogg': new Set(['audio/ogg', 'application/ogg']),
  '.webm': new Set(['audio/webm']),
};
const audioContainers: Record<string, string[]> = {
  '.mp3': ['mpeg'],
  '.wav': ['wav', 'wave'],
  '.m4a': ['mp4', 'm4a', 'quicktime'],
  '.aac': ['adts', 'aac'],
  '.flac': ['flac'],
  '.ogg': ['ogg'],
  '.webm': ['webm'],
};

/** 音频上传信任边界使用的稳定验证错误。 */
export class AudioUploadValidationError extends Error {
  constructor(
    public readonly code:
      'AUDIO_TOO_LARGE' | 'INVALID_FILE' | 'TOO_MANY_FILES' | 'UNSUPPORTED_FORMAT',
    message: string,
  ) {
    super(message);
    this.name = 'AudioUploadValidationError';
  }
}

function validateBatch(files: File[]) {
  if (files.length === 0) {
    throw new AudioUploadValidationError('INVALID_FILE', '至少选择一个音频文件。');
  }
  if (files.length > MAX_AUDIO_FILES) {
    throw new AudioUploadValidationError('TOO_MANY_FILES', '单批最多上传 20 个音频文件。');
  }
  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  if (files.some((file) => file.size > MAX_AUDIO_BYTES) || totalBytes > MAX_AUDIO_BYTES) {
    throw new AudioUploadValidationError(
      'AUDIO_TOO_LARGE',
      '单个文件和整批文件总大小均不能超过 200 MB。',
    );
  }
}

async function inspectAudio(file: File): Promise<{ buffer: Buffer; item: StoredAudioUpload }> {
  if (file.size === 0) {
    throw new AudioUploadValidationError('INVALID_FILE', '不能上传空音频文件。');
  }
  const originalFilename = path.basename(file.name);
  const extension = path.extname(originalFilename).toLowerCase();
  const allowedMimes = audioMimeTypes[extension];
  if (!allowedMimes) {
    throw new AudioUploadValidationError(
      'UNSUPPORTED_FORMAT',
      '仅支持 MP3、WAV、M4A、AAC、FLAC、OGG 和 WebM 音频。',
    );
  }
  const mimeType = file.type.toLowerCase().split(';')[0]?.trim() || 'application/octet-stream';
  if (mimeType !== 'application/octet-stream' && !allowedMimes.has(mimeType)) {
    throw new AudioUploadValidationError('INVALID_FILE', '文件扩展名与 MIME 类型不一致。');
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  let durationMs: number;
  try {
    const metadata = await parseBuffer(buffer, {
      mimeType: mimeType === 'application/octet-stream' ? undefined : mimeType,
      path: originalFilename,
      size: buffer.byteLength,
    });
    const container = metadata.format.container?.toLowerCase() ?? '';
    if (!audioContainers[extension]!.some((candidate) => container.includes(candidate))) {
      throw new Error('container mismatch');
    }
    if (
      metadata.format.duration === undefined ||
      !Number.isFinite(metadata.format.duration) ||
      metadata.format.duration <= 0
    ) {
      throw new Error('duration unavailable');
    }
    durationMs = Math.round(metadata.format.duration * 1_000);
  } catch {
    throw new AudioUploadValidationError('INVALID_FILE', '无法识别有效的音频文件结构。');
  }
  const storageKey = `${randomUUID()}${extension}`;
  return {
    buffer,
    item: {
      title: path.basename(originalFilename, extension),
      originalFilename,
      mimeType: mimeType === 'application/octet-stream' ? [...allowedMimes][0]! : mimeType,
      sizeBytes: buffer.byteLength,
      durationMs,
      storageKey,
    },
  };
}

/** HTTP 传输层依赖的音频工作区接口。 */
export interface WorkspaceService {
  listGroups(): ReturnType<WorkspaceRepository['listGroups']>;
  getGroup(id: string): ReturnType<WorkspaceRepository['getGroup']>;
  getGroupSettings(id: string): ReturnType<WorkspaceRepository['getGroupSettings']>;
  updateGroupSettings(
    id: string,
    input: GroupSettingsUpdateRequest,
  ): ReturnType<WorkspaceRepository['updateGroupSettings']>;
  createGroup(input: GroupCreateRequest): ReturnType<WorkspaceRepository['createGroup']>;
  archiveGroup(id: string): ReturnType<WorkspaceRepository['archiveGroup']>;
  listGroupAudioFiles(id: string): ReturnType<WorkspaceRepository['listGroupAudioFiles']>;
  listGroupKnowledgeBases(id: string): ReturnType<WorkspaceRepository['listGroupKnowledgeBases']>;
  replaceGroupKnowledgeBases(
    id: string,
    input: GroupResourceLinksUpdateRequest,
  ): ReturnType<WorkspaceRepository['replaceGroupKnowledgeBases']>;
  listKnowledgeBaseGroups(id: string): ReturnType<WorkspaceRepository['listKnowledgeBaseGroups']>;
  linkKnowledgeBaseGroups(
    id: string,
    input: KnowledgeBaseGroupLinkRequest,
  ): ReturnType<WorkspaceRepository['linkKnowledgeBaseGroups']>;
  listGroupDataSources(id: string): ReturnType<WorkspaceRepository['listGroupDataSources']>;
  replaceGroupDataSources(
    id: string,
    input: GroupResourceLinksUpdateRequest,
  ): ReturnType<WorkspaceRepository['replaceGroupDataSources']>;
  listDataSources(): ReturnType<WorkspaceRepository['listDataSources']>;
  createDataSource(
    input: DataSourceCreateRequest,
  ): ReturnType<WorkspaceRepository['createDataSource']>;
  getDataSource(id: string): ReturnType<WorkspaceRepository['getDataSource']>;
  updateDataSource(
    id: string,
    input: DataSourceUpdateRequest,
  ): ReturnType<WorkspaceRepository['updateDataSource']>;
  archiveDataSource(id: string): ReturnType<WorkspaceRepository['archiveDataSource']>;
  listDataSourceAudioFiles(id: string): ReturnType<WorkspaceRepository['listDataSourceAudioFiles']>;
  listDataSourceIngestionRecords(
    id: string,
  ): ReturnType<WorkspaceRepository['listDataSourceIngestionRecords']>;
  listDataSourceGroups(id: string): ReturnType<WorkspaceRepository['listDataSourceGroups']>;
  linkDataSourceGroups(
    id: string,
    input: DataSourceGroupLinkRequest,
  ): ReturnType<WorkspaceRepository['linkDataSourceGroups']>;
  unlinkDataSourceGroup(
    id: string,
    groupId: string,
  ): ReturnType<WorkspaceRepository['unlinkDataSourceGroup']>;
  uploadDataSourceAudioFiles(id: string, files: File[]): Promise<DataSourceAudioUploadResponse>;
  archiveDataSourceAudioFile(
    id: string,
    audioFileId: string,
  ): ReturnType<WorkspaceRepository['archiveDataSourceAudioFile']>;
  getAudioPlaybackFile(id: string): Promise<AudioPlaybackFile>;
  getAudioTranscriptionCapabilities(): ReturnType<AudioInputPreprocessor['capabilities']>;
  startAudioTranscription(
    id: string,
    input: AudioTranscriptionStartRequest,
  ): Promise<Awaited<ReturnType<AudioAnalysisRepository['queueTranscription']>>>;
  getAudioAnalysis(
    id: string,
    groupId?: string,
  ): Promise<Awaited<ReturnType<WorkspaceRepository['getAudioAnalysis']>>>;
  confirmAudioTranscript(
    id: string,
    input: AudioTranscriptConfirmationRequest,
  ): ReturnType<TranscriptConfirmationRepository['confirm']>;
  startAudioPostAnalysis(
    id: string,
    type: AudioPostAnalysisType,
  ): Promise<Awaited<ReturnType<PostAnalysisRepository['queue']>>>;
  startAudioBusinessAnalysis(
    id: string,
    input: AudioBusinessAnalysisStartRequest,
  ): ReturnType<BusinessAnalysisRepository['queue']>;
}

/** 直接组合窄仓储分组生命周期与读取能力的默认工作区服务。 */
export class DefaultWorkspaceService implements WorkspaceService {
  constructor(
    private readonly repository: WorkspaceRepository,
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
  ) {}

  listGroups() {
    return this.repository.listGroups();
  }
  getGroup(id: string) {
    return this.repository.getGroup(id);
  }
  getGroupSettings(id: string) {
    return this.repository.getGroupSettings(id);
  }
  updateGroupSettings(id: string, input: GroupSettingsUpdateRequest) {
    return this.repository.updateGroupSettings(id, input);
  }
  createGroup(input: GroupCreateRequest) {
    return this.repository.createGroup(input);
  }
  archiveGroup(id: string) {
    return this.repository.archiveGroup(id);
  }
  listGroupAudioFiles(id: string) {
    return this.repository.listGroupAudioFiles(id);
  }
  listGroupKnowledgeBases(id: string) {
    return this.repository.listGroupKnowledgeBases(id);
  }
  replaceGroupKnowledgeBases(id: string, input: GroupResourceLinksUpdateRequest) {
    return this.repository.replaceGroupKnowledgeBases(id, input);
  }
  listKnowledgeBaseGroups(id: string) {
    return this.repository.listKnowledgeBaseGroups(id);
  }
  linkKnowledgeBaseGroups(id: string, input: KnowledgeBaseGroupLinkRequest) {
    return this.repository.linkKnowledgeBaseGroups(id, input);
  }
  listGroupDataSources(id: string) {
    return this.repository.listGroupDataSources(id);
  }
  replaceGroupDataSources(id: string, input: GroupResourceLinksUpdateRequest) {
    return this.repository.replaceGroupDataSources(id, input);
  }
  listDataSources() {
    return this.repository.listDataSources();
  }
  createDataSource(input: DataSourceCreateRequest) {
    return this.repository.createDataSource(input);
  }
  getDataSource(id: string) {
    return this.repository.getDataSource(id);
  }
  updateDataSource(id: string, input: DataSourceUpdateRequest) {
    return this.repository.updateDataSource(id, input);
  }
  archiveDataSource(id: string) {
    return this.repository.archiveDataSource(id);
  }
  listDataSourceAudioFiles(id: string) {
    return this.repository.listDataSourceAudioFiles(id);
  }
  listDataSourceIngestionRecords(id: string) {
    return this.repository.listDataSourceIngestionRecords(id);
  }
  listDataSourceGroups(id: string) {
    return this.repository.listDataSourceGroups(id);
  }
  linkDataSourceGroups(id: string, input: DataSourceGroupLinkRequest) {
    return this.repository.linkDataSourceGroups(id, input);
  }
  unlinkDataSourceGroup(id: string, groupId: string) {
    return this.repository.unlinkDataSourceGroup(id, groupId);
  }

  /** 校验并持久保存整批音频，仅在全部文件和数据库事实成功后发布响应。 */
  async uploadDataSourceAudioFiles(id: string, files: File[]) {
    validateBatch(files);
    await this.repository.getDataSource(id);
    const inspected = await Promise.all(files.map((file) => inspectAudio(file)));
    const root = path.resolve(this.audioStorageDirectory);
    await mkdir(root, { recursive: true });
    const writtenPaths: string[] = [];
    try {
      for (const audio of inspected) {
        const target = path.resolve(root, audio.item.storageKey);
        if (!target.startsWith(`${root}${path.sep}`)) {
          throw new AudioUploadValidationError('INVALID_FILE', '音频存储路径无效。');
        }
        await writeFile(target, audio.buffer, { flag: 'wx', mode: 0o600 });
        writtenPaths.push(target);
      }
      return await this.repository.createDataSourceAudioUpload(
        id,
        inspected.map((audio) => audio.item),
      );
    } catch (error) {
      await Promise.all(writtenPaths.map((target) => unlink(target).catch(() => undefined)));
      throw error;
    }
  }

  archiveDataSourceAudioFile(id: string, audioFileId: string) {
    return this.repository.archiveDataSourceAudioFile(id, audioFileId);
  }

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
