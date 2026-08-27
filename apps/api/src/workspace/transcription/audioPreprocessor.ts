/**
 * DashScope 整文件转写预处理器。
 *
 * 使用可选外部 FFmpeg 将服务器保存的原音频转换为单声道 16kHz MP3，供 OSS 暂存和
 * DashScope Filetrans 说话人分离任务使用。
 *
 * Responsibilities:
 * - 校验源文件和临时文件始终位于配置目录内。
 * - 为每个修订生成唯一整文件转码产物并负责清理。
 * - 非致命探测 FFmpeg，并向客户端提供转写可用性快照。
 *
 * Notes:
 * - 不提供原文件直传、分块或自动拆分路径。
 */
import { spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

import {
  AUDIO_TRANSCRIPTION_MODEL_CAPABILITIES,
  AudioTranscriptionCapabilitiesResponseSchema,
  type AudioTranscriptionCapabilitiesResponse,
  type AudioTranscriptionModel,
} from '@echowave/contracts';

import type { ClaimedAudioTranscription } from '../persistence/audioAnalysisRepository.ts';

/** 一段经过转码、可提交到 OSS 的完整音频。 */
export type WholeAudioFile = {
  durationMs: number;
  path: string;
};

/** 外部转码命令失败，且不会暴露命令行中的本地路径。 */
export class AudioPreprocessingError extends Error {
  constructor(
    public readonly code: 'TRANSCODER_UNAVAILABLE' | 'TRANSCRIPTION_FAILED',
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

/** 使用 FFmpeg 生成 DashScope 说话人分离所需的完整单声道音频。 */
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

  /** 为修订生成固定格式的单声道完整 MP3。 */
  async createWholeFile(job: ClaimedAudioTranscription): Promise<WholeAudioFile> {
    if (job.durationMs <= 0) {
      throw new AudioPreprocessingError('TRANSCRIPTION_FAILED', '音频时长无效，无法转写。');
    }
    const sourcePath = resolveWithin(this.options.audioStorageDirectory, job.storageKey);
    const jobDirectory = resolveWithin(this.options.tempDirectory, job.revisionId);
    await rm(jobDirectory, { force: true, recursive: true });
    await mkdir(jobDirectory, { recursive: true });
    const outputPath = resolveWithin(jobDirectory, 'whole-file.mp3');
    await this.runner(this.options.ffmpegPath, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      sourcePath,
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
    return { durationMs: job.durationMs, path: outputPath };
  }

  /** 删除当前修订的全部临时转码产物。 */
  async cleanup(revisionId: string): Promise<void> {
    await rm(resolveWithin(this.options.tempDirectory, revisionId), {
      force: true,
      recursive: true,
    });
  }
}

/** 缓存 FFmpeg 探测结果并暴露唯一官方转写路径。 */
export class AudioInputPreprocessor {
  private ffmpegAvailable = false;
  private readonly ffmpeg?: FfmpegAudioPreprocessor;

  constructor(
    private readonly options: {
      audioStorageDirectory: string;
      ffmpegPath?: string;
      tempDirectory: string;
      processRunner?: ProcessRunner;
      defaultModel: AudioTranscriptionModel;
      transcriptionConfigured: boolean;
    },
  ) {
    if (options.ffmpegPath) {
      this.ffmpeg = new FfmpegAudioPreprocessor({
        audioStorageDirectory: options.audioStorageDirectory,
        ffmpegPath: options.ffmpegPath,
        tempDirectory: options.tempDirectory,
        processRunner: options.processRunner,
      });
    }
  }

  /** 探测 FFmpeg 但不抛出错误，确保缺少转码器时 API 仍可提供其他能力。 */
  async probeFfmpeg(): Promise<AudioTranscriptionCapabilitiesResponse> {
    await this.refreshFfmpegAvailability();
    return this.capabilities();
  }

  /** 在创建任务前重新检查可执行文件，避免只信任启动时缓存。 */
  async refreshFfmpegAvailability(): Promise<boolean> {
    if (!this.ffmpeg) {
      this.ffmpegAvailable = false;
      return false;
    }
    try {
      await this.ffmpeg.verify();
      this.ffmpegAvailable = true;
    } catch {
      this.ffmpegAvailable = false;
    }
    return this.ffmpegAvailable;
  }

  /** 返回 DashScope、OSS 与 FFmpeg 共同决定的转写能力。 */
  capabilities(): AudioTranscriptionCapabilitiesResponse {
    const available = this.options.transcriptionConfigured && this.ffmpegAvailable;
    return AudioTranscriptionCapabilitiesResponseSchema.parse({
      defaultModel: this.options.defaultModel,
      models: AUDIO_TRANSCRIPTION_MODEL_CAPABILITIES.map((model) => ({
        ...model,
        available,
        unavailableReason: available
          ? null
          : !this.options.transcriptionConfigured
            ? '服务端尚未完整配置 DashScope 与北京地域 OSS。'
            : '服务端 FFmpeg 不可用，无法生成说话人分离所需的单声道整文件。',
      })),
      ffmpeg: { configured: Boolean(this.options.ffmpegPath), available: this.ffmpegAvailable },
      transcriptionConfigured: this.options.transcriptionConfigured,
    });
  }

  /** 创建唯一受支持的整文件转写输入。 */
  async createWholeFile(job: ClaimedAudioTranscription): Promise<WholeAudioFile> {
    if (!this.ffmpeg || !this.ffmpegAvailable) {
      throw new AudioPreprocessingError(
        'TRANSCODER_UNAVAILABLE',
        'FFmpeg 当前不可用，无法生成说话人分离所需的单声道整文件。',
      );
    }
    return this.ffmpeg.createWholeFile(job);
  }

  /** 清理当前修订的临时整文件。 */
  cleanup(job: ClaimedAudioTranscription): Promise<void> {
    if (!this.ffmpeg) return Promise.resolve();
    return this.ffmpeg.cleanup(job.revisionId);
  }
}
