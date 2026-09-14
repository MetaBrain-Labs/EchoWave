/**
 * 正式案例独立音频存储。
 *
 * 复用音频窗口裁剪器，将真实来源轮次固化到知识持久目录。
 *
 * Responsibilities:
 * - 从现有音频服务读取受控本地或对象存储来源。
 * - 保留独立 MP3 并限制读取、删除目标。
 *
 * Notes:
 * - 不延长源音频保留期，不使用模型临时 OSS 保存学习音频。
 */
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, mkdir, open, readdir, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { CaseTurn } from '@echowave/contracts';
import type { AudioService, AudioPlaybackFile } from '../../workspace/audio/core/service.ts';
import { AudioWindowPreprocessor } from '../../workspace/audio/post-analysis/audioWindowPreprocessor.ts';
import { RagRepositoryError } from '../persistence/errors.ts';
import { caseMediaKey } from './policy.ts';

/** 案例音频归档与受控播放能力。 */
export class CaseMediaStore {
  private readonly root: string;
  private readonly preprocessor: AudioWindowPreprocessor;
  constructor(
    private readonly options: {
      knowledgeDirectory: string;
      audioDirectory: string;
      tempDirectory: string;
      ffmpegPath?: string;
      audio: Pick<AudioService, 'getAudioPlaybackFile'>;
    },
  ) {
    this.root = path.resolve(options.knowledgeDirectory, 'case-media');
    this.preprocessor = new AudioWindowPreprocessor({
      audioStorageDirectory: options.audioDirectory,
      tempDirectory: options.tempDirectory,
      ...(options.ffmpegPath ? { ffmpegPath: options.ffmpegPath } : {}),
    });
  }
  /** 存储键必须是服务器生成的单个 UUID 文件名。 */
  private resolveKey(key: string): string {
    if (!/^[0-9a-f-]{36}\.mp3$/.test(key))
      throw new RagRepositoryError('NOT_FOUND', '案例音频不存在。');
    const target = path.resolve(this.root, key);
    if (path.dirname(target) !== this.root)
      throw new RagRepositoryError('NOT_FOUND', '案例音频不存在。');
    return target;
  }
  /** 只下载数据库定位的签名来源，写入有界临时文件并校验长度。 */
  async source(
    audioFileId: string,
    taskId: string,
  ): Promise<{ storageKey: string; sourcePathOverride?: string; cleanup: () => Promise<void> }> {
    const source = await this.options.audio.getAudioPlaybackFile(audioFileId);
    if (source.kind === 'local')
      return {
        storageKey: path.relative(this.options.audioDirectory, source.absolutePath!),
        cleanup: async () => undefined,
      };
    await mkdir(this.options.tempDirectory, { recursive: true });
    const target = path.resolve(
      this.options.tempDirectory,
      `case-source-${taskId}-${randomUUID()}.audio`,
    );
    const file = await open(target, 'wx', 0o600);
    try {
      const response = await fetch(source.remoteUrl!, { signal: AbortSignal.timeout(60_000) });
      if (!response.ok || !response.body) throw new Error('Source unavailable.');
      let bytes = 0;
      for await (const chunk of response.body) {
        bytes += chunk.byteLength;
        if (bytes > source.sizeBytes) throw new Error('Invalid source length.');
        await file.writeFile(chunk);
      }
      if (bytes !== source.sizeBytes) throw new Error('Incomplete source.');
    } catch (error) {
      await file.close();
      await unlink(target).catch(() => undefined);
      throw error;
    }
    await file.close();
    return {
      storageKey: '',
      sourcePathOverride: target,
      cleanup: async () => {
        await unlink(target).catch(() => undefined);
      },
    };
  }
  /** 按来源的绝对毫秒范围生成一个独立学习轮次。 */
  async archive(
    taskId: string,
    turn: CaseTurn,
    index: number,
    source: { storageKey: string; sourcePathOverride?: string },
  ): Promise<string> {
    const key = caseMediaKey(taskId, turn.segmentId);
    if (await this.findArchived(taskId, turn.segmentId)) return key;
    const windowJobId = `${taskId}-${randomUUID()}`;
    const output = await this.preprocessor.createWindow({
      jobId: windowJobId,
      windowIndex: index,
      startMs: turn.startMs,
      endMs: turn.endMs,
      ...source,
    });
    await mkdir(this.root, { recursive: true });
    const staged = path.resolve(this.root, `${key}.${randomUUID()}.part`);
    try {
      await copyFile(output, staged, constants.COPYFILE_EXCL);
      // 完整副本才原子发布到确定键，恢复不能误认复制中的半个文件。
      await rename(staged, this.resolveKey(key));
    } finally {
      await unlink(staged).catch(() => undefined);
      await unlink(output).catch(() => undefined);
      await this.preprocessor.cleanup(windowJobId);
    }
    return key;
  }
  /** 恢复已归档但尚未写回数据库的受控轮次。 */
  async findArchived(taskId: string, segmentId: string): Promise<string | undefined> {
    const key = caseMediaKey(taskId, segmentId);
    const info = await stat(this.resolveKey(key)).catch(() => undefined);
    return info?.isFile() && info.size > 0 ? key : undefined;
  }
  /** 删除范围始终限制在知识库媒体目录；缺失文件视为已回收。 */
  async remove(key: string): Promise<void> {
    await unlink(this.resolveKey(key)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
    const files = await readdir(this.root).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return [];
    });
    for (const name of files) {
      if (!name.startsWith(`${key}.`) || !/\.mp3\.[0-9a-f-]{36}\.part$/.test(name)) continue;
      const target = path.resolve(this.root, name);
      if (path.dirname(target) === this.root) await unlink(target);
    }
  }
  /** 返回现有 HTTP Range 播放设施可消费的本地描述。 */
  async playback(key: string): Promise<AudioPlaybackFile> {
    const absolutePath = this.resolveKey(key);
    const info = await stat(absolutePath).catch(() => undefined);
    if (!info?.isFile() || info.size <= 0)
      throw new RagRepositoryError('NOT_FOUND', '案例音频文件不可用，请重试生成。');
    return {
      kind: 'local',
      absolutePath,
      mimeType: 'audio/mpeg',
      originalFilename: 'case-turn.mp3',
      lastModified: info.mtime,
      sizeBytes: info.size,
    };
  }
}
