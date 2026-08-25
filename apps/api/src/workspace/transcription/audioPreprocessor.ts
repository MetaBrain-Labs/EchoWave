/**
 * 音频转写预处理器。
 *
 * 根据修订快照选择原音频直传，或通过可选外部 FFmpeg 将上传格式统一为小体积
 * MP3 分块，为 OpenRouter 的 base64 音频输入建立明确格式和时间边界。
 *
 * Responsibilities:
 * - 校验所有源文件和临时文件均位于配置目录内。
 * - 生成短原音频逻辑分块或无重叠的 45 秒单声道转写分块。
 * - 在模型输出异常时从原音频重新编码两个不短于十秒的子分块。
 * - 清理任务临时目录并非致命探测 FFmpeg 可用性。
 *
 * Notes:
 * - 不捆绑 FFmpeg；未配置 FFMPEG_PATH 时仍可使用 direct 模式。
 */
import { spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

import {
  AUDIO_TRANSCRIPTION_DIRECT_FORMATS,
  AUDIO_TRANSCRIPTION_DIRECT_MAX_BYTES,
  AUDIO_TRANSCRIPTION_DIRECT_MAX_DURATION_MS,
  AUDIO_TRANSCRIPTION_MODEL_CAPABILITIES,
  AudioTranscriptionCapabilitiesResponseSchema,
  type AudioTranscriptionCapabilitiesResponse,
  type AudioTranscriptionDirectFormat,
  type AudioTranscriptionModel,
} from '@echowave/contracts';

import type { ClaimedAudioTranscription } from '../persistence/audioAnalysisRepository.ts';

const CHUNK_DURATION_MS = 45_000;
/** 自适应细分允许的最小子分块主区间。 */
export const MINIMUM_CHUNK_DURATION_MS = 10_000;

/** 一段经过转码、带全局时间定位的模型输入。 */
export type AudioChunk = {
  durationMs: number;
  format: AudioTranscriptionDirectFormat;
  offsetMs: number;
  path: string;
  primaryEndMs: number;
  primaryStartMs: number;
};

/** 外部命令执行失败，且不会暴露命令行中的本地路径。 */
export class AudioPreprocessingError extends Error {
  constructor(
    public readonly code:
      'DIRECT_AUDIO_REJECTED' | 'TRANSCODER_UNAVAILABLE' | 'TRANSCRIPTION_FAILED',
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'AudioPreprocessingError';
  }
}

export type ProcessRunner = (executable: string, args: string[]) => Promise<void>;

const runProcess: ProcessRunner = (executable, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: 'ignore', windowsHide: true });
    child.once('error', () =>
      reject(
        new AudioPreprocessingError(
          'TRANSCODER_UNAVAILABLE',
          'FFmpeg 不可用，请检查服务端 FFMPEG_PATH 配置。',
        ),
      ),
    );
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else
        reject(new AudioPreprocessingError('TRANSCRIPTION_FAILED', '音频转码失败，无法开始转写。'));
    });
  });

function resolveWithin(root: string, child: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, child);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new AudioPreprocessingError('TRANSCRIPTION_FAILED', '音频文件路径无效。');
  }
  return resolved;
}

/** 使用外部 FFmpeg 生成并清理 OpenRouter 可消费的 MP3 分块。 */
export class FfmpegAudioPreprocessor {
  private readonly runner: ProcessRunner;

  constructor(
    private readonly options: {
      audioStorageDirectory: string;
      ffmpegPath: string;
      tempDirectory: string;
      processRunner?: ProcessRunner;
    },
  ) {
    this.runner = options.processRunner ?? runProcess;
  }

  /** 在 API 开始监听前确认配置的 FFmpeg 可以执行。 */
  async verify(): Promise<void> {
    await this.runner(this.options.ffmpegPath, ['-version']);
  }

  private async encodeRange(
    job: ClaimedAudioTranscription,
    primaryStartMs: number,
    primaryEndMs: number,
  ): Promise<AudioChunk> {
    const sourcePath = resolveWithin(this.options.audioStorageDirectory, job.storageKey);
    const jobDirectory = resolveWithin(this.options.tempDirectory, job.revisionId);
    await mkdir(jobDirectory, { recursive: true });
    const offsetMs = primaryStartMs;
    const encodedEndMs = primaryEndMs;
    const outputPath = resolveWithin(jobDirectory, `chunk-${primaryStartMs}-${primaryEndMs}.mp3`);
    await this.runner(this.options.ffmpegPath, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-ss',
      String(offsetMs / 1_000),
      '-i',
      sourcePath,
      '-t',
      String((encodedEndMs - offsetMs) / 1_000),
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-b:a',
      '64k',
      '-y',
      outputPath,
    ]);
    return {
      durationMs: encodedEndMs - offsetMs,
      format: 'mp3',
      offsetMs,
      path: outputPath,
      primaryEndMs,
      primaryStartMs,
    };
  }

  /** 将完整录音转成固定码率、无重叠的顺序 MP3 分块。 */
  async createChunks(job: ClaimedAudioTranscription): Promise<AudioChunk[]> {
    if (job.durationMs <= 0) {
      throw new AudioPreprocessingError('TRANSCRIPTION_FAILED', '音频时长无效，无法转写。');
    }
    const jobDirectory = resolveWithin(this.options.tempDirectory, job.revisionId);
    await rm(jobDirectory, { force: true, recursive: true });
    const chunks: AudioChunk[] = [];
    const count = Math.ceil(job.durationMs / CHUNK_DURATION_MS);
    for (let index = 0; index < count; index += 1) {
      const primaryStartMs = index * CHUNK_DURATION_MS;
      const primaryEndMs = Math.min(job.durationMs, (index + 1) * CHUNK_DURATION_MS);
      chunks.push(await this.encodeRange(job, primaryStartMs, primaryEndMs));
    }
    return chunks;
  }

  /** 将输出异常的主区间从原音频重新编码为两个不短于十秒的子分块。 */
  async splitChunk(job: ClaimedAudioTranscription, chunk: AudioChunk): Promise<AudioChunk[]> {
    const primaryDurationMs = chunk.primaryEndMs - chunk.primaryStartMs;
    const firstDurationMs = Math.floor(primaryDurationMs / 2);
    const secondDurationMs = primaryDurationMs - firstDurationMs;
    if (
      firstDurationMs < MINIMUM_CHUNK_DURATION_MS ||
      secondDurationMs < MINIMUM_CHUNK_DURATION_MS
    ) {
      throw new AudioPreprocessingError(
        'TRANSCRIPTION_FAILED',
        '当前音频分块无法在保持十秒下限的情况下继续细分。',
        true,
      );
    }
    const midpointMs = chunk.primaryStartMs + Math.floor(primaryDurationMs / 2);
    const first = await this.encodeRange(job, chunk.primaryStartMs, midpointMs);
    const second = await this.encodeRange(job, midpointMs, chunk.primaryEndMs);
    return [first, second];
  }

  /** 删除当前修订的全部临时转码产物。 */
  async cleanup(revisionId: string): Promise<void> {
    const jobDirectory = resolveWithin(this.options.tempDirectory, revisionId);
    await rm(jobDirectory, { force: true, recursive: true });
  }
}

function directFormat(storageKey: string): AudioTranscriptionDirectFormat | undefined {
  const extension = path.extname(storageKey).slice(1).toLowerCase();
  return AUDIO_TRANSCRIPTION_DIRECT_FORMATS.find((candidate) => candidate === extension);
}

/** 不创建临时文件，直接把受支持的完整原音频交给 OpenRouter。 */
export class DirectAudioPreprocessor {
  constructor(private readonly audioStorageDirectory: string) {}

  /** 为完整原文件建立一个零偏移逻辑分块。 */
  async createChunks(job: ClaimedAudioTranscription): Promise<AudioChunk[]> {
    const format = directFormat(job.storageKey);
    if (
      !format ||
      !Number.isFinite(job.sizeBytes) ||
      job.sizeBytes > AUDIO_TRANSCRIPTION_DIRECT_MAX_BYTES ||
      job.durationMs > AUDIO_TRANSCRIPTION_DIRECT_MAX_DURATION_MS
    ) {
      throw new AudioPreprocessingError(
        'DIRECT_AUDIO_REJECTED',
        '原音频无法直接发送，请启用 FFmpeg 预处理后重试。',
      );
    }
    return [
      {
        durationMs: job.durationMs,
        format,
        offsetMs: 0,
        path: resolveWithin(this.audioStorageDirectory, job.storageKey),
        primaryEndMs: job.durationMs,
        primaryStartMs: 0,
      },
    ];
  }
}

/** 在 FFmpeg 分块和原文件直传之间按修订快照选择，且缓存非致命能力探测结果。 */
export class AudioInputPreprocessor {
  private ffmpegAvailable = false;
  private readonly direct: DirectAudioPreprocessor;
  private readonly ffmpeg?: FfmpegAudioPreprocessor;

  constructor(
    private readonly options: {
      audioStorageDirectory: string;
      ffmpegPath?: string;
      tempDirectory: string;
      processRunner?: ProcessRunner;
      defaultModel: AudioTranscriptionModel;
    },
  ) {
    this.direct = new DirectAudioPreprocessor(options.audioStorageDirectory);
    if (options.ffmpegPath) {
      this.ffmpeg = new FfmpegAudioPreprocessor({
        audioStorageDirectory: options.audioStorageDirectory,
        ffmpegPath: options.ffmpegPath,
        tempDirectory: options.tempDirectory,
        processRunner: options.processRunner,
      });
    }
  }

  /** 探测 FFmpeg 但不抛出错误，确保缺少可执行文件时 API 仍可提供直传。 */
  async probeFfmpeg(): Promise<AudioTranscriptionCapabilitiesResponse> {
    await this.refreshFfmpegAvailability();
    return this.capabilities();
  }

  /** 在创建 FFmpeg 任务前重新检查可执行文件，避免只信任启动时缓存。 */
  async refreshFfmpegAvailability(): Promise<boolean> {
    if (this.ffmpeg) {
      try {
        await this.ffmpeg.verify();
        this.ffmpegAvailable = true;
      } catch {
        this.ffmpegAvailable = false;
      }
    } else {
      this.ffmpegAvailable = false;
    }
    return this.ffmpegAvailable;
  }

  /** 返回当前进程缓存的转写预处理能力。 */
  capabilities(): AudioTranscriptionCapabilitiesResponse {
    return AudioTranscriptionCapabilitiesResponseSchema.parse({
      defaultModel: this.options.defaultModel,
      models: AUDIO_TRANSCRIPTION_MODEL_CAPABILITIES,
      ffmpeg: { configured: Boolean(this.options.ffmpegPath), available: this.ffmpegAvailable },
      direct: {
        maxBytes: AUDIO_TRANSCRIPTION_DIRECT_MAX_BYTES,
        maxDurationMs: AUDIO_TRANSCRIPTION_DIRECT_MAX_DURATION_MS,
        formats: [...AUDIO_TRANSCRIPTION_DIRECT_FORMATS],
      },
    });
  }

  /** 根据任务创建时持久化的模式选择唯一预处理路径。 */
  createChunks(job: ClaimedAudioTranscription): Promise<AudioChunk[]> {
    if (job.preprocessingMode === 'direct') return this.direct.createChunks(job);
    if (!this.ffmpeg || !this.ffmpegAvailable) {
      throw new AudioPreprocessingError(
        'TRANSCODER_UNAVAILABLE',
        'FFmpeg 当前不可用，请取消预处理后直接转写。',
      );
    }
    return this.ffmpeg.createChunks(job);
  }

  /** 仅在 FFmpeg 修订中将输出超限 Chunk 原位拆成两个子分块。 */
  splitChunk(job: ClaimedAudioTranscription, chunk: AudioChunk): Promise<AudioChunk[]> {
    if (job.preprocessingMode === 'direct' || !this.ffmpeg) {
      throw new AudioPreprocessingError(
        'DIRECT_AUDIO_REJECTED',
        '原音频输出超出模型限制，请启用 FFmpeg 预处理后重试。',
        true,
      );
    }
    return this.ffmpeg.splitChunk(job, chunk);
  }

  /** direct 模式无临时文件，FFmpeg 模式清理当前修订目录。 */
  cleanup(job: ClaimedAudioTranscription): Promise<void> {
    if (job.preprocessingMode === 'direct' || !this.ffmpeg) return Promise.resolve();
    return this.ffmpeg.cleanup(job.revisionId);
  }
}
