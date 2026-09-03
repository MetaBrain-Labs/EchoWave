/**
 * 情绪分析音频窗口预处理器。
 *
 * 根据已发布说话轮次裁剪带少量上下文的单声道 MP3，避免把完整录音重复发送给模型。
 *
 * Responsibilities:
 * - 将窗口路径限制在配置的音频和临时目录内。
 * - 生成 16kHz 单声道情绪分析片段并清理任务临时文件。
 *
 * Notes:
 * - 窗口边界由 worker 计算，本模块不解释转写语义。
 */
import { spawn } from 'node:child_process';
import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

export class AudioWindowPreprocessingError extends Error {
  constructor(
    public readonly code: 'TRANSCODER_UNAVAILABLE' | 'ANALYSIS_PREPROCESSING_FAILED',
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'AudioWindowPreprocessingError';
  }
}

type ProcessRunner = (executable: string, args: string[]) => Promise<void>;

const runProcess: ProcessRunner = (executable, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: 'ignore', windowsHide: true });
    child.once('error', () =>
      reject(
        new AudioWindowPreprocessingError(
          'TRANSCODER_UNAVAILABLE',
          'FFmpeg 不可用，无法生成情绪分析音频窗口。',
        ),
      ),
    );
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else
        reject(
          new AudioWindowPreprocessingError(
            'ANALYSIS_PREPROCESSING_FAILED',
            `情绪分析音频窗口生成失败（FFmpeg exit code: ${formatExitCode(code)}）。`,
            true,
          ),
        );
    });
  });

function formatExitCode(code: number | null): string {
  if (code === null) return 'unknown';
  // Windows 会把 FFmpeg 返回的负 errno 展示为无符号 32 位整数，恢复成可读的有符号值。
  return code > 0x7fffffff ? String(code - 0x100000000) : String(code);
}

function resolveWithin(root: string, child: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, child);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new AudioWindowPreprocessingError(
      'ANALYSIS_PREPROCESSING_FAILED',
      '情绪分析音频路径无效。',
    );
  }
  return resolved;
}

/** 为情绪 worker 创建和清理任务级音频窗口。 */
export class AudioWindowPreprocessor {
  private readonly runner: ProcessRunner;

  constructor(
    private readonly options: {
      audioStorageDirectory: string;
      ffmpegPath?: string;
      tempDirectory: string;
      processRunner?: ProcessRunner;
    },
  ) {
    this.runner = options.processRunner ?? runProcess;
  }

  /** 裁剪指定绝对时间范围并统一编码为模型输入格式。 */
  async createWindow(input: {
    jobId: string;
    storageKey: string;
    windowIndex: number;
    startMs: number;
    endMs: number;
    sourcePathOverride?: string;
  }): Promise<string> {
    if (!this.options.ffmpegPath) {
      throw new AudioWindowPreprocessingError(
        'TRANSCODER_UNAVAILABLE',
        'FFmpeg 尚未配置，无法执行情绪分析。',
      );
    }
    const source = input.sourcePathOverride
      ? resolveWithin(
          this.options.tempDirectory,
          path.relative(this.options.tempDirectory, input.sourcePathOverride),
        )
      : resolveWithin(this.options.audioStorageDirectory, input.storageKey);
    const sourceStats = await stat(source).catch(() => undefined);
    if (!sourceStats?.isFile() || sourceStats.size <= 0) {
      throw new AudioWindowPreprocessingError(
        'ANALYSIS_PREPROCESSING_FAILED',
        '情绪分析源音频不存在或不可读。',
        true,
      );
    }
    const directory = resolveWithin(this.options.tempDirectory, `post-analysis/${input.jobId}`);
    await mkdir(directory, { recursive: true });
    const output = resolveWithin(directory, `window-${input.windowIndex}.mp3`);
    await this.runner(this.options.ffmpegPath, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-ss',
      (input.startMs / 1_000).toFixed(3),
      '-i',
      source,
      '-t',
      ((input.endMs - input.startMs) / 1_000).toFixed(3),
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-b:a',
      '64k',
      '-y',
      output,
    ]);
    const outputStats = await stat(output).catch(() => undefined);
    if (!outputStats?.isFile() || outputStats.size <= 0) {
      throw new AudioWindowPreprocessingError(
        'ANALYSIS_PREPROCESSING_FAILED',
        '情绪分析音频窗口生成失败（FFmpeg 未生成有效音频文件）。',
        true,
      );
    }
    return output;
  }

  /** 删除一个后置分析任务的全部临时文件。 */
  async cleanup(jobId: string): Promise<void> {
    await rm(resolveWithin(this.options.tempDirectory, `post-analysis/${jobId}`), {
      force: true,
      recursive: true,
    });
  }
}
