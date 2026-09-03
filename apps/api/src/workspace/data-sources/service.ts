/**
 * 数据源领域服务端口。
 *
 * 定义数据源生命周期、分组关联和音频上传能力。
 *
 * Responsibilities:
 * - 为 HTTP 路由提供显式用例返回类型。
 * - 隔离上传协调与持久化实现。
 *
 * Notes:
 * - 音频转写和分析不属于本端口。
 */
import type {
  AudioFileSummary,
  DataSourceAudioUploadResponse,
  DataSourceCreateRequest,
  DataSourceDetail,
  DataSourceGroupLinkRequest,
  DataSourceIngestionRecord,
  DataSourceSummary,
  DataSourceUpdateRequest,
  LinkedDataSourceGroup,
} from '@echowave/contracts';
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseBuffer } from 'music-metadata';

import type { DataSourceRepository, StoredAudioUpload } from './repository.ts';
import { WorkspaceRepositoryError } from '../errors.ts';

/** 数据源路由依赖的应用服务端口。 */
export interface DataSourceService {
  listDataSources(): Promise<{ items: DataSourceSummary[] }>;
  createDataSource(input: DataSourceCreateRequest): Promise<DataSourceDetail>;
  getDataSource(id: string): Promise<DataSourceDetail>;
  updateDataSource(id: string, input: DataSourceUpdateRequest): Promise<DataSourceDetail>;
  archiveDataSource(id: string): Promise<void>;
  listDataSourceAudioFiles(id: string): Promise<{ items: AudioFileSummary[] }>;
  listDataSourceIngestionRecords(id: string): Promise<{ items: DataSourceIngestionRecord[] }>;
  listDataSourceGroups(id: string): Promise<{ items: LinkedDataSourceGroup[] }>;
  linkDataSourceGroups(
    id: string,
    input: DataSourceGroupLinkRequest,
  ): Promise<{ items: LinkedDataSourceGroup[] }>;
  unlinkDataSourceGroup(id: string, groupId: string): Promise<void>;
  uploadDataSourceAudioFiles(id: string, files: File[]): Promise<DataSourceAudioUploadResponse>;
  archiveDataSourceAudioFile(id: string, audioFileId: string): Promise<void>;
}

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

/** 直接组合数据源持久化与受控文件存储的默认服务。 */
export class DefaultDataSourceService implements DataSourceService {
  constructor(
    private readonly repository: DataSourceRepository,
    private readonly audioStorageDirectory: string,
    private readonly currentAudioMode: () => Promise<string> = async () => 'hybrid',
  ) {}

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

  /** 校验并持久保存整批音频，仅在文件和数据库事实全部成功后发布响应。 */
  async uploadDataSourceAudioFiles(id: string, files: File[]) {
    if ((await this.currentAudioMode()) !== 'hybrid') {
      throw new WorkspaceRepositoryError(
        'CONFLICT',
        '当前运行模式要求使用上传会话，不能使用混合模式 multipart 接口。',
      );
    }
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
}
