/**
 * 音频后置分析后台 worker。
 *
 * 同一个实现按类型装配为独立情绪与角色 worker，各自保持单并发并通过 PostgreSQL
 * `FOR UPDATE SKIP LOCKED` 领取任务。
 *
 * Responsibilities:
 * - 编排模型调用、进度、版本化发布和安全失败。
 * - 为情绪任务生成有界音频窗口，并在结构失败时递归二分。
 *
 * Notes:
 * - worker 不修改原始转写，失败不会清除既有 active 后处理结果。
 */
import type { AudioPostAnalysisType } from '@echowave/contracts';

import {
  noOpAiExecutionReporter,
  type AiExecutionReporter,
} from '../../ai-observability/executionReporter.ts';
import {
  type ClaimedPostAnalysisJob,
  type EmotionPublication,
  PostAnalysisRepository,
  type PostAnalysisTranscriptSegment,
} from '../persistence/postAnalysisRepository.ts';
import type { OssStagingStore } from '../transcription/ossStagingStore.ts';
import {
  AudioWindowPreprocessingError,
  AudioWindowPreprocessor,
} from './audioWindowPreprocessor.ts';
import type { DeepSeekRoleRecognizer } from './deepSeekRoleRecognizer.ts';
import { PostAnalysisProviderError, type QwenEmotionAnalyzer } from './qwenEmotionAnalyzer.ts';

const MAX_WINDOW_MS = 5 * 60 * 1_000;
const MAX_WINDOW_SEGMENTS = 50;
const WINDOW_CONTEXT_MS = 1_000;

/** 将连续说话轮次组合成不超过时长和数量上限的初始窗口。 */
export function buildEmotionWindows(
  segments: PostAnalysisTranscriptSegment[],
): PostAnalysisTranscriptSegment[][] {
  const windows: PostAnalysisTranscriptSegment[][] = [];
  let current: PostAnalysisTranscriptSegment[] = [];
  for (const segment of segments.filter(({ text }) => text.trim().length > 0)) {
    const first = current[0];
    if (
      first &&
      (current.length >= MAX_WINDOW_SEGMENTS || segment.endMs - first.startMs > MAX_WINDOW_MS)
    ) {
      windows.push(current);
      current = [];
    }
    current.push(segment);
  }
  if (current.length > 0) windows.push(current);
  return windows;
}

type WorkerOptions = {
  type: AudioPostAnalysisType;
  repository: PostAnalysisRepository;
  emotionAnalyzer?: QwenEmotionAnalyzer;
  roleRecognizer?: DeepSeekRoleRecognizer;
  preprocessor?: AudioWindowPreprocessor;
  ossStaging?: OssStagingStore;
  reporter?: AiExecutionReporter;
};

/** 周期领取并执行一种后置分析任务。 */
export class AudioPostAnalysisWorker {
  private active?: Promise<void>;
  private pumping = false;
  private stopping = false;
  private timer?: NodeJS.Timeout;
  private windowSequence = 0;

  constructor(private readonly options: WorkerOptions) {}

  /** 重新排队中断任务后开始轮询。 */
  async start(): Promise<void> {
    if (this.timer) return;
    this.stopping = false;
    await this.options.repository.resetInterrupted(this.options.type);
    this.timer = setInterval(() => void this.pump(), 750);
    this.timer.unref();
    void this.pump();
  }

  /** 停止领取并等待当前任务收敛。 */
  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (this.active) await Promise.allSettled([this.active]);
  }

  private async pump(): Promise<void> {
    if (this.pumping || this.stopping || this.active) return;
    this.pumping = true;
    try {
      const job = await this.options.repository.claim(this.options.type);
      if (!job) return;
      const execution = this.execute(job).finally(() => {
        if (this.active === execution) this.active = undefined;
        if (!this.stopping) void this.pump();
      });
      this.active = execution;
    } catch (error) {
      console.error('Failed to claim audio post-analysis job', {
        type: this.options.type,
        error: error instanceof Error ? error.name : 'UnknownError',
      });
    } finally {
      this.pumping = false;
    }
  }

  private async execute(job: ClaimedPostAnalysisJob): Promise<void> {
    const report = (this.options.reporter ?? noOpAiExecutionReporter).start({
      kind: job.type === 'emotion' ? 'audio-emotion-analysis' : 'audio-role-recognition',
      name:
        job.type === 'emotion'
          ? 'EchoWave audio emotion analysis'
          : 'EchoWave speaker role recognition',
      metadata: {
        audioFileId: job.audioFileId,
        revisionId: job.revisionId,
        confirmationId: job.confirmationId,
        confirmationVersion: job.confirmationVersion,
        jobId: job.id,
        model: job.model,
        segmentCount: job.segments.length,
      },
    });
    const startedAt = Date.now();
    try {
      if (job.segments.length === 0) {
        throw new PostAnalysisProviderError(
          'INVALID_MODEL_OUTPUT',
          '转写中没有可分析的正文片段。',
          false,
        );
      }
      if (job.type === 'emotion') await this.executeEmotion(job);
      else await this.executeRole(job);
      await report.finish({
        status: 'completed',
        metadata: { durationMs: Date.now() - startedAt },
      });
    } catch (error) {
      const known =
        error instanceof PostAnalysisProviderError ||
        error instanceof AudioWindowPreprocessingError;
      const code = known ? error.code : 'INTERNAL_ERROR';
      const message = known ? error.message : '音频分析失败，请稍后重试。';
      const retryable = known ? error.retryable : true;
      await this.options.repository.fail(job.id, code, message, retryable);
      await report.finish({
        status: 'failed',
        error,
        metadata: { code, retryable, durationMs: Date.now() - startedAt },
      });
      console.error('Audio post-analysis failed', {
        audioFileId: job.audioFileId,
        jobId: job.id,
        type: job.type,
        code,
      });
    } finally {
      if (job.type === 'emotion' && this.options.preprocessor) {
        await this.options.preprocessor.cleanup(job.id).catch(() => undefined);
      }
    }
  }

  private async executeRole(job: ClaimedPostAnalysisJob): Promise<void> {
    if (!this.options.roleRecognizer) {
      throw new PostAnalysisProviderError('MODEL_UNAVAILABLE', '角色识别模型尚未配置。', false);
    }
    const results = await this.options.roleRecognizer.recognize(
      job.segments,
      job.customBusinessRoles,
    );
    await this.options.repository.updateProgress(job.id, 95);
    await this.options.repository.publishRoles(job, results);
  }

  private async executeEmotion(job: ClaimedPostAnalysisJob): Promise<void> {
    if (!this.options.emotionAnalyzer || !this.options.preprocessor || !this.options.ossStaging) {
      throw new PostAnalysisProviderError(
        'MODEL_UNAVAILABLE',
        '情绪分析所需的 Qwen、OSS 或 FFmpeg 尚未完整配置。',
        false,
      );
    }
    this.windowSequence = 0;
    const initialWindows = buildEmotionWindows(job.segments);
    const results: EmotionPublication[] = [];
    for (const window of initialWindows) {
      results.push(...(await this.analyzeEmotionWindow(job, window)));
      await this.options.repository.updateProgress(
        job.id,
        5 + (results.length / job.segments.length) * 88,
      );
    }
    const unique = new Map(results.map((result) => [result.segmentId, result]));
    if (unique.size !== job.segments.length) {
      throw new PostAnalysisProviderError(
        'INVALID_MODEL_OUTPUT',
        '情绪分析未覆盖全部转写片段。',
        true,
      );
    }
    await this.options.repository.updateProgress(job.id, 95);
    await this.options.repository.publishEmotion(job, [...unique.values()]);
  }

  private async analyzeEmotionWindow(
    job: ClaimedPostAnalysisJob,
    segments: PostAnalysisTranscriptSegment[],
  ): Promise<EmotionPublication[]> {
    const startMs = Math.max(0, segments[0]!.startMs - WINDOW_CONTEXT_MS);
    const endMs = Math.min(job.durationMs, segments.at(-1)!.endMs + WINDOW_CONTEXT_MS);
    this.windowSequence += 1;
    const path = await this.options.preprocessor!.createWindow({
      jobId: job.id,
      storageKey: job.storageKey,
      windowIndex: this.windowSequence,
      startMs,
      endMs,
    });
    const objectKey = await this.options.ossStaging!.uploadEmotionWindow(job.id, path);
    try {
      return await this.options.emotionAnalyzer!.analyze(
        this.options.ossStaging!.signedGetUrl(objectKey),
        segments.map((segment) => ({
          ...segment,
          relativeStartMs: segment.startMs - startMs,
          relativeEndMs: segment.endMs - startMs,
        })),
      );
    } catch (error) {
      if (
        error instanceof PostAnalysisProviderError &&
        error.code === 'INVALID_MODEL_OUTPUT' &&
        segments.length > 1
      ) {
        const middle = Math.ceil(segments.length / 2);
        return [
          ...(await this.analyzeEmotionWindow(job, segments.slice(0, middle))),
          ...(await this.analyzeEmotionWindow(job, segments.slice(middle))),
        ];
      }
      throw error;
    } finally {
      await this.options.ossStaging!.delete(objectKey).catch(() => {
        console.warn('Failed to clean transient emotion analysis object', { jobId: job.id });
      });
    }
  }
}
