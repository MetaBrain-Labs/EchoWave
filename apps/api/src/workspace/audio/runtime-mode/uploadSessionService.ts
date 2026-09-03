/**
 * 音频上传会话应用服务。
 *
 * 根据租户当前模式选择 API 流式上传或企业 OSS 直传，确认文件指纹与音频元数据后自动创建首个 ASR Run。
 *
 * Responsibilities:
 * - 保证大文件上传与校验不整文件载入内存。
 * - 固化对象存储配置 revision，并在完成确认后启动可恢复转写。
 *
 * Notes:
 * - 混合模式继续使用既有 multipart 接口，不经过本服务。
 */
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import {
  AUDIO_TRANSCRIPTION_MODEL_CAPABILITIES,
  AudioUploadSessionCompleteResponseSchema,
  AudioUploadSessionCreateRequestSchema,
  AudioUploadSessionResponseSchema,
  AudioSourceRemountResponseSchema,
  type AudioUploadSessionCreateRequest,
} from '@echowave/contracts';
import { parseFile } from 'music-metadata';

import type { SettingsService } from '../../../settings/service.ts';
import { WorkspaceRepositoryError } from '../../errors.ts';
import type { AudioService } from '../core/service.ts';
import type { AudioRuntimeRepository } from './repository.ts';
import { PrimaryOssStore } from './primaryOssStore.ts';
import type {
  AudioUploadSessionRepository,
  StoredUploadSession,
} from './uploadSessionRepository.ts';

const allowedExtensions = new Set(['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.webm']);
const MAX_AUDIO_DURATION_MS = 12 * 60 * 60 * 1_000;

function safeFilename(value: string): string {
  const filename = path.basename(value);
  const extension = path.extname(filename).toLowerCase();
  if (!allowedExtensions.has(extension)) {
    throw new WorkspaceRepositoryError('BAD_REQUEST', '不支持该音频文件格式。');
  }
  return filename;
}

function resolveWithin(root: string, child: string): string {
  const absoluteRoot = path.resolve(root);
  const target = path.resolve(absoluteRoot, child);
  if (!target.startsWith(`${absoluteRoot}${path.sep}`)) {
    throw new WorkspaceRepositoryError('BAD_REQUEST', '音频存储路径无效。');
  }
  return target;
}

async function inspectAndFingerprint(
  filePath: string,
): Promise<{ durationMs: number; sha256: string }> {
  const hash = createHash('sha256');
  await pipeline(
    createReadStream(filePath),
    new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk);
        callback(null, chunk);
      },
    }),
    new Transform({
      transform(_chunk, _encoding, callback) {
        callback();
      },
    }),
  );
  const metadata = await parseFile(filePath);
  const seconds = metadata.format.duration;
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) {
    throw new WorkspaceRepositoryError('BAD_REQUEST', '无法识别有效的音频时长。');
  }
  return { durationMs: Math.round(seconds * 1_000), sha256: hash.digest('hex') };
}

/** 编排上传目标、完成校验与首个 ASR Run。 */
export class AudioUploadSessionService {
  constructor(
    private readonly repository: AudioUploadSessionRepository,
    private readonly runtimeRepository: AudioRuntimeRepository,
    private readonly settings: SettingsService,
    private readonly audio: AudioService,
    private readonly options: {
      audioStorageDirectory: string;
      tempDirectory: string;
      tenantId: string;
    },
  ) {}

  private async objectStore(bindingRevisionId?: string): Promise<PrimaryOssStore> {
    const capability = await this.settings.resolveCapability(
      'audio_primary_storage',
      bindingRevisionId,
    );
    if (
      capability.provider.type !== 'aliyun_oss' ||
      !('accessKeyId' in capability.provider.credential)
    ) {
      throw new WorkspaceRepositoryError('CONFLICT', '权威音频对象存储配置不兼容。');
    }
    const config = capability.provider.config as { bucket: string; region: string };
    return new PrimaryOssStore({
      accessKeyId: capability.provider.credential.accessKeyId,
      accessKeySecret: capability.provider.credential.accessKeySecret,
      bucket: config.bucket,
      region: config.region,
      tenantId: this.options.tenantId,
    });
  }

  /** 为单个音频初始化当前模式对应的上传会话。 */
  async create(dataSourceId: string, rawInput: AudioUploadSessionCreateRequest) {
    const input = AudioUploadSessionCreateRequestSchema.parse({
      ...rawInput,
      filename: safeFilename(rawInput.filename),
    });
    const runtime = await this.runtimeRepository.get();
    if (runtime.mode === 'hybrid' && input.sizeBytes < 0) {
      throw new WorkspaceRepositoryError('CONFLICT', '混合模式请使用现有批量上传接口。');
    }
    let bindingRevisionId: string | null = null;
    let store: PrimaryOssStore | undefined;
    let storageKey: string;
    if (runtime.mode === 'object_storage') {
      const binding = await this.settings.resolveCapability('audio_primary_storage');
      bindingRevisionId = binding.revisionId;
      store = await this.objectStore(binding.revisionId ?? undefined);
      storageKey = store.createSourceKey(input.filename);
    } else {
      storageKey = `${randomUUID()}${path.extname(input.filename).toLowerCase()}`;
    }
    const session = await this.repository.create(
      dataSourceId,
      input,
      runtime,
      runtime.mode === 'object_storage'
        ? {
            backend: 'aliyun_oss',
            bindingRevisionId,
            key: storageKey,
            strategy: 'presigned_put',
          }
        : {
            backend: runtime.mode === 'hybrid' ? 'local_persistent' : 'local_ephemeral',
            bindingRevisionId: null,
            key: storageKey,
            strategy: 'api_binary',
          },
    );
    const expiresAt = session.expiresAt.toISOString();
    return AudioUploadSessionResponseSchema.parse({
      id: session.id,
      audioFileId: session.audioFileId,
      mode: session.mode,
      expiresAt,
      upload:
        session.strategy === 'presigned_put'
          ? {
              kind: 'presigned_put',
              url: store!.signedPutUrl(storageKey, input.mimeType),
              headers: { 'Content-Type': input.mimeType },
              expiresAt,
            }
          : {
              kind: 'api_binary',
              url: `/api/audio-upload-sessions/${session.id}/content`,
              headers: { 'Content-Type': input.mimeType },
            },
    });
  }

  /** 把轻量模式请求体流式写入 API 临时原音频目录。 */
  async uploadBinary(id: string, body: ReadableStream<Uint8Array> | null, contentLength: number) {
    const session = await this.repository.get(id);
    this.assertWritable(session, 'api_binary');
    if (!body || contentLength !== session.sizeBytes) {
      throw new WorkspaceRepositoryError('BAD_REQUEST', '上传字节数与会话声明不一致。');
    }
    const target = resolveWithin(this.options.audioStorageDirectory, session.storageKey);
    await mkdir(path.dirname(target), { recursive: true });
    try {
      await pipeline(
        Readable.from(body as unknown as AsyncIterable<Uint8Array>),
        createWriteStream(target, { flags: 'wx', mode: 0o600 }),
      );
      const stored = await stat(target);
      if (stored.size !== session.sizeBytes) throw new Error('size mismatch');
      await this.repository.markUploaded(id);
    } catch (error) {
      await rm(target, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  /** 校验本地或 OSS 音频并自动排队首次转写。 */
  async complete(id: string) {
    const session = await this.repository.get(id);
    if (session.status === 'ready') {
      await this.ensureInitialTranscription(session);
      return AudioUploadSessionCompleteResponseSchema.parse({
        audioFileId: session.audioFileId,
        status: 'ready',
      });
    }
    if (session.expiresAt <= new Date())
      throw new WorkspaceRepositoryError('CONFLICT', '上传会话已过期。');
    let sourcePath: string;
    let temporary = false;
    if (session.strategy === 'api_binary') {
      sourcePath = resolveWithin(this.options.audioStorageDirectory, session.storageKey);
    } else {
      const store = await this.objectStore(session.storageBindingRevisionId ?? undefined);
      if ((await store.size(session.storageKey)) !== session.sizeBytes) {
        throw new WorkspaceRepositoryError('BAD_REQUEST', '对象存储中的文件大小与会话声明不一致。');
      }
      const directory = resolveWithin(
        this.options.tempDirectory,
        `upload-validation/${session.id}`,
      );
      await mkdir(directory, { recursive: true });
      sourcePath = resolveWithin(directory, session.filename);
      temporary = true;
      const response = await fetch(store.signedGetUrl(session.storageKey));
      if (!response.ok || !response.body) throw new Error(`object-download-${response.status}`);
      await pipeline(
        Readable.from(response.body as unknown as AsyncIterable<Uint8Array>),
        createWriteStream(sourcePath, { mode: 0o600 }),
      );
    }
    try {
      const inspected = await inspectAndFingerprint(sourcePath);
      if (inspected.durationMs > MAX_AUDIO_DURATION_MS) {
        throw new WorkspaceRepositoryError(
          'BAD_REQUEST',
          '音频时长超过 12 小时限制，请先压缩或拆分后再上传。',
        );
      }
      await this.repository.complete(id, inspected.durationMs, inspected.sha256);
      await this.ensureInitialTranscription(session);
      return AudioUploadSessionCompleteResponseSchema.parse({
        audioFileId: session.audioFileId,
        status: 'ready',
      });
    } finally {
      if (temporary) await rm(path.dirname(sourcePath), { force: true, recursive: true });
    }
  }

  /**
   * 确保上传确认和首次 ASR 排队之间的进程中断可以通过重复 complete 请求收敛。
   */
  private async ensureInitialTranscription(session: StoredUploadSession): Promise<void> {
    const existing = await this.audio.listAudioTranscriptions(session.audioFileId);
    if (existing.items.length > 0) return;
    try {
      await this.audio.startAudioTranscription(session.audioFileId, {
        model: AUDIO_TRANSCRIPTION_MODEL_CAPABILITIES[0].id,
        preprocessing: 'silero_vad',
        segmentationMode: 'speaker_turn',
        includeAcousticEmotion: session.includeAcousticEmotion,
      });
    } catch (error) {
      // 并发 complete 可能都观察到空列表；已有 Run 即证明另一请求已完成排队。
      const afterRace = await this.audio.listAudioTranscriptions(session.audioFileId);
      if (afterRace.items.length === 0) throw error;
    }
  }

  private assertWritable(session: StoredUploadSession, strategy: StoredUploadSession['strategy']) {
    if (
      session.strategy !== strategy ||
      session.status !== 'created' ||
      session.expiresAt <= new Date()
    ) {
      throw new WorkspaceRepositoryError('CONFLICT', '上传会话状态不允许写入。');
    }
  }

  /** 流式接收用户重新选择的原音频，SHA-256 完全一致时恢复源文件可用状态。 */
  async remountSource(
    audioFileId: string,
    filename: string,
    body: ReadableStream<Uint8Array> | null,
    contentLength: number,
  ) {
    const asset = await this.repository.getRemountAsset(audioFileId);
    const safe = safeFilename(decodeURIComponent(filename));
    if (!body || contentLength !== asset.sizeBytes) {
      throw new WorkspaceRepositoryError('BAD_REQUEST', '重新选择的文件大小与原音频不一致。');
    }
    const storageKey = `${randomUUID()}${path.extname(safe).toLowerCase()}`;
    const target = resolveWithin(this.options.audioStorageDirectory, storageKey);
    await mkdir(path.dirname(target), { recursive: true });
    try {
      await pipeline(
        Readable.from(body as unknown as AsyncIterable<Uint8Array>),
        createWriteStream(target, { flags: 'wx', mode: 0o600 }),
      );
      const inspected = await inspectAndFingerprint(target);
      if (inspected.durationMs > MAX_AUDIO_DURATION_MS) {
        throw new WorkspaceRepositoryError(
          'BAD_REQUEST',
          '音频时长超过 12 小时限制，请先压缩或拆分后再上传。',
        );
      }
      if (inspected.sha256 !== asset.sha256) {
        throw new WorkspaceRepositoryError(
          'BAD_REQUEST',
          '重新选择的文件指纹不匹配，请选择最初上传的同一份原音频。',
        );
      }
      await this.repository.completeRemount(audioFileId, storageKey);
      if (asset.previousStorageKey && asset.previousStorageKey !== storageKey) {
        // 新定位键已提交后，旧失败副本只做补偿式清理；清理失败不能破坏已经恢复的资产。
        try {
          await rm(resolveWithin(this.options.audioStorageDirectory, asset.previousStorageKey), {
            force: true,
          });
        } catch {
          // 后续生命周期补偿仍会收敛遗留临时文件。
        }
      }
      return AudioSourceRemountResponseSchema.parse({
        audioFileId,
        sourceState: 'available',
        sha256: inspected.sha256,
      });
    } catch (error) {
      await rm(target, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}
