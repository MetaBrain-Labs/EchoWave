/**
 * DashScope 整文件与 Silero VAD 音频预处理器。
 *
 * 使用 FFmpeg 生成 16kHz 单声道 MP3；可选路径先流式运行 Silero VAD，再只编码需要
 * 保留的原始 PCM 区间，并返回可恢复原时间轴的预处理清单。
 *
 * Responsibilities:
 * - 校验源文件和临时文件始终位于配置目录内。
 * - 提供整文件与空闲音频过滤两条互不降级的预处理路径。
 * - 非致命探测 FFmpeg 和 Silero，并向客户端提供独立可用性快照。
 *
 * Notes:
 * - 不上传音频，也不负责供应商任务生命周期。
 */
import { spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Writable } from 'node:stream';

import type {
  AudioTranscriptionCapabilitiesResponse,
  AudioTranscriptionPreprocessing,
} from '@echowave/contracts';

import type { ClaimedAudioTranscription } from './repository.ts';
import {
  SILERO_VAD_MODEL,
  SileroVoiceActivityDetector,
  VOICE_ACTIVITY_POLICY,
  VoiceActivityError,
  type VoiceActivityManifest,
} from './voiceActivity.ts';

const DEFAULT_VAD_MODEL_PATH = fileURLToPath(
  new URL('../../../../assets/silero-vad/v6.2.1/silero_vad.onnx', import.meta.url),
);

/** 一段经过转码、可提交到 OSS 的完整音频。 */
export type WholeAudioFile = {
  durationMs: number;
  manifest?: VoiceActivityManifest;
  path: string;
};

/** 服务端本地音频预处理依赖的探测结果，不包含供应商或 Credential 状态。 */
export type AudioPreprocessingCapabilities = Pick<
  AudioTranscriptionCapabilitiesResponse,
  'ffmpeg' | 'sileroVad'
>;

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

type VoiceActivityDetector = Pick<SileroVoiceActivityDetector, 'detect' | 'verify'>;
type VoiceActivityFileProcessor = {
  detect(sourcePath: string): Promise<VoiceActivityManifest>;
  encode(sourcePath: string, outputPath: string, manifest: VoiceActivityManifest): Promise<void>;
};

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

function processCompletion(child: ReturnType<typeof spawn>, message: string): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once('error', () =>
      reject(new AudioPreprocessingError('TRANSCODER_UNAVAILABLE', message, true)),
    );
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new AudioPreprocessingError('TRANSCRIPTION_FAILED', message, true));
    });
  });
}

async function writeWithBackpressure(stream: Writable, chunk: Buffer): Promise<void> {
  if (!stream.write(chunk)) await once(stream, 'drain');
}

/** 使用 FFmpeg 生成 DashScope 说话人分离所需的完整单声道音频。 */
export class FfmpegAudioPreprocessor {
  private readonly runner: ProcessRunner;
  private readonly detector: VoiceActivityDetector;

  constructor(
    private readonly options: {
      audioStorageDirectory: string;
      ffmpegPath: string;
      tempDirectory: string;
      processRunner?: ProcessRunner;
      voiceActivityDetector?: VoiceActivityDetector;
      voiceActivityFileProcessor?: VoiceActivityFileProcessor;
      vadModelPath?: string;
    },
  ) {
    this.runner = options.processRunner ?? runProcess;
    this.detector =
      options.voiceActivityDetector ??
      new SileroVoiceActivityDetector(options.vadModelPath ?? DEFAULT_VAD_MODEL_PATH);
  }

  /** 在 API 开始监听前确认配置的 FFmpeg 可以执行。 */
  async verify(): Promise<void> {
    await this.runner(this.options.ffmpegPath, ['-version']);
  }

  /** 在 API 开始监听前校验固定模型资产并创建 ONNX 会话。 */
  async verifyVad(): Promise<void> {
    await this.detector.verify();
  }

  /** 根据 revision 中固定的预处理模式生成单个 MP3。 */
  async createWholeFile(
    job: ClaimedAudioTranscription,
    sourcePathOverride?: string,
  ): Promise<WholeAudioFile> {
    if (job.durationMs <= 0) {
      throw new AudioPreprocessingError('TRANSCRIPTION_FAILED', '音频时长无效，无法转写。');
    }
    const sourcePath = sourcePathOverride
      ? resolveWithin(
          this.options.tempDirectory,
          path.relative(this.options.tempDirectory, sourcePathOverride),
        )
      : resolveWithin(this.options.audioStorageDirectory, job.storageKey);
    const jobDirectory = resolveWithin(this.options.tempDirectory, job.revisionId);
    await rm(jobDirectory, { force: true, recursive: true });
    await mkdir(jobDirectory, { recursive: true });
    const outputPath = resolveWithin(jobDirectory, 'whole-file.mp3');

    if (job.preprocessingMode === 'silero_vad') {
      const manifest = this.options.voiceActivityFileProcessor
        ? await this.options.voiceActivityFileProcessor.detect(sourcePath)
        : await this.detectVoiceActivity(sourcePath);
      if (this.options.voiceActivityFileProcessor) {
        await this.options.voiceActivityFileProcessor.encode(sourcePath, outputPath, manifest);
      } else {
        await this.encodeFilteredAudio(sourcePath, outputPath, manifest);
      }
      return { durationMs: manifest.processedDurationMs, manifest, path: outputPath };
    }

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

  private async detectVoiceActivity(sourcePath: string): Promise<VoiceActivityManifest> {
    const decoder = spawn(
      this.options.ffmpegPath,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        sourcePath,
        '-vn',
        '-ac',
        '1',
        '-ar',
        String(VOICE_ACTIVITY_POLICY.sampleRate),
        '-f',
        's16le',
        'pipe:1',
      ],
      { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true },
    );
    const completion = processCompletion(decoder, 'FFmpeg 无法解码音频供空闲检测使用。');
    void completion.catch(() => undefined);
    try {
      const manifest = await this.detector.detect(decoder.stdout!);
      await completion;
      return manifest;
    } catch (error) {
      decoder.kill();
      await completion.catch(() => undefined);
      throw error;
    }
  }

  private async encodeFilteredAudio(
    sourcePath: string,
    outputPath: string,
    manifest: VoiceActivityManifest,
  ): Promise<void> {
    const decoder = spawn(
      this.options.ffmpegPath,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        sourcePath,
        '-vn',
        '-ac',
        '1',
        '-ar',
        String(VOICE_ACTIVITY_POLICY.sampleRate),
        '-f',
        's16le',
        'pipe:1',
      ],
      { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true },
    );
    const encoder = spawn(
      this.options.ffmpegPath,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        's16le',
        '-ar',
        String(VOICE_ACTIVITY_POLICY.sampleRate),
        '-ac',
        '1',
        '-i',
        'pipe:0',
        '-vn',
        '-b:a',
        '64k',
        '-y',
        outputPath,
      ],
      { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true },
    );
    const decoderCompletion = processCompletion(decoder, 'FFmpeg 无法解码待过滤音频。');
    const encoderCompletion = processCompletion(encoder, 'FFmpeg 无法编码过滤后的音频。');
    void decoderCompletion.catch(() => undefined);
    void encoderCompletion.catch(() => undefined);
    const bytesPerMs = (VOICE_ACTIVITY_POLICY.sampleRate * 2) / 1_000;
    const separator = Buffer.alloc(Math.round(VOICE_ACTIVITY_POLICY.separatorMs * bytesPerMs));
    let sourceByteOffset = 0;
    let spanIndex = 0;
    let separatorWritten = false;

    try {
      for await (const chunk of decoder.stdout!) {
        const buffer = Buffer.from(chunk);
        const chunkStart = sourceByteOffset;
        const chunkEnd = chunkStart + buffer.length;
        while (spanIndex < manifest.sourceSpans.length) {
          const span = manifest.sourceSpans[spanIndex]!;
          const spanStart = Math.round(span.originalStartMs * bytesPerMs);
          const spanEnd = Math.round(span.originalEndMs * bytesPerMs);
          if (spanStart >= chunkEnd) break;
          if (spanEnd <= chunkStart) {
            spanIndex += 1;
            separatorWritten = false;
            continue;
          }
          if (spanIndex > 0 && !separatorWritten) {
            await writeWithBackpressure(encoder.stdin!, separator);
            separatorWritten = true;
          }
          const copyStart = Math.max(spanStart, chunkStart) - chunkStart;
          const copyEnd = Math.min(spanEnd, chunkEnd) - chunkStart;
          if (copyEnd > copyStart) {
            await writeWithBackpressure(encoder.stdin!, buffer.subarray(copyStart, copyEnd));
          }
          if (spanEnd <= chunkEnd) {
            spanIndex += 1;
            separatorWritten = false;
            continue;
          }
          break;
        }
        sourceByteOffset = chunkEnd;
      }
      encoder.stdin!.end();
      await Promise.all([decoderCompletion, encoderCompletion]);
      if (spanIndex !== manifest.sourceSpans.length) {
        throw new VoiceActivityError(
          'VOICE_ACTIVITY_DETECTION_FAILED',
          '原音频时长与空闲检测结果不一致，请重试。',
          true,
        );
      }
    } catch (error) {
      decoder.kill();
      encoder.kill();
      await Promise.allSettled([decoderCompletion, encoderCompletion]);
      throw error;
    }
  }
}

/** 缓存服务端音频预处理依赖的探测结果。 */
export class AudioInputPreprocessor {
  private ffmpegAvailable = false;
  private sileroVadAvailable = false;
  private readonly ffmpeg?: FfmpegAudioPreprocessor;

  constructor(
    private readonly options: {
      audioStorageDirectory: string;
      ffmpegPath?: string;
      tempDirectory: string;
      processRunner?: ProcessRunner;
      voiceActivityDetector?: VoiceActivityDetector;
      voiceActivityFileProcessor?: VoiceActivityFileProcessor;
      vadModelPath?: string;
    },
  ) {
    if (options.ffmpegPath) {
      this.ffmpeg = new FfmpegAudioPreprocessor({
        audioStorageDirectory: options.audioStorageDirectory,
        ffmpegPath: options.ffmpegPath,
        tempDirectory: options.tempDirectory,
        processRunner: options.processRunner,
        voiceActivityDetector: options.voiceActivityDetector,
        voiceActivityFileProcessor: options.voiceActivityFileProcessor,
        vadModelPath: options.vadModelPath,
      });
    }
  }

  /** 探测全部本地依赖但不阻止 API 提供其他能力。 */
  async probeFfmpeg(): Promise<AudioPreprocessingCapabilities> {
    await this.refreshFfmpegAvailability();
    await this.refreshVadAvailability();
    return this.capabilities();
  }

  /** 在创建任务前重新检查 FFmpeg，避免只信任启动时缓存。 */
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

  /** 重新校验模型资产和 ONNX 会话，不影响整文件模式。 */
  async refreshVadAvailability(): Promise<boolean> {
    if (!this.ffmpeg || !this.ffmpegAvailable) {
      this.sileroVadAvailable = false;
      return false;
    }
    try {
      await this.ffmpeg.verifyVad();
      this.sileroVadAvailable = true;
    } catch {
      this.sileroVadAvailable = false;
    }
    return this.sileroVadAvailable;
  }

  /** 返回 FFmpeg 与 Silero 的纯本地状态，避免被数据库 Provider 配置污染。 */
  capabilities(): AudioPreprocessingCapabilities {
    return {
      ffmpeg: { configured: Boolean(this.options.ffmpegPath), available: this.ffmpegAvailable },
      sileroVad: {
        model: SILERO_VAD_MODEL,
        available: this.ffmpegAvailable && this.sileroVadAvailable,
        unavailableReason:
          this.ffmpegAvailable && this.sileroVadAvailable
            ? null
            : !this.ffmpegAvailable
              ? '请先配置并启用 FFmpeg。'
              : 'Silero VAD 模型或 ONNX Runtime 当前不可用。',
      },
    };
  }

  /** 在排队前验证用户明确选择的预处理模式。 */
  async refreshModeAvailability(mode: AudioTranscriptionPreprocessing): Promise<boolean> {
    if (!(await this.refreshFfmpegAvailability())) return false;
    if (mode === 'whole_file') return true;
    return this.refreshVadAvailability();
  }

  /** 创建 revision 明确选择的整文件转写输入。 */
  async createWholeFile(
    job: ClaimedAudioTranscription,
    sourcePathOverride?: string,
  ): Promise<WholeAudioFile> {
    if (!this.ffmpeg || !this.ffmpegAvailable) {
      throw new AudioPreprocessingError(
        'TRANSCODER_UNAVAILABLE',
        'FFmpeg 当前不可用，无法生成说话人分离所需的单声道整文件。',
      );
    }
    if (job.preprocessingMode === 'silero_vad' && !this.sileroVadAvailable) {
      throw new VoiceActivityError('VAD_UNAVAILABLE', 'Silero VAD 当前不可用。', true);
    }
    return this.ffmpeg.createWholeFile(job, sourcePathOverride);
  }

  /** 清理当前 revision 的全部临时文件。 */
  cleanup(job: ClaimedAudioTranscription): Promise<void> {
    if (!this.ffmpeg) return Promise.resolve();
    return this.ffmpeg.cleanup(job.revisionId);
  }
}
