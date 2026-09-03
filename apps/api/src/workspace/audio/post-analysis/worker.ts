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
 * - PostgreSQL 通知负责低延迟唤醒，15 秒安全扫描负责通知遗漏恢复。
 */
import type { AudioPostAnalysisType } from '@echowave/contracts';

import {
  noOpAiExecutionReporter,
  type AiExecutionRecorder,
  type AiExecutionReporter,
} from '../../../ai-observability/executionReporter.ts';
import type { LiveUpdateBroker } from '../../../infrastructure/liveUpdateBroker.ts';
import type { WorkerWakeupSource } from '../../../infrastructure/workerWakeup.ts';
import {
  type ClaimedPostAnalysisJob,
  type EmotionPublication,
  type EmotionWindowResult,
  PostAnalysisRepository,
  type PostAnalysisTranscriptSegment,
} from './repository.ts';
import type { AudioArtifactStore } from '../transcription/audioArtifactStore.ts';
import type { PrimaryOssStore } from '../runtime-mode/primaryOssStore.ts';
import path from 'node:path';
import { runReportedStep } from '../../../ai-runtime/reportedStep.ts';
import {
  AudioWindowPreprocessingError,
  AudioWindowPreprocessor,
} from './audioWindowPreprocessor.ts';
import type { DeepSeekRoleRecognizer } from './deepSeekRoleRecognizer.ts';
import { PostAnalysisProviderError, type QwenEmotionAnalyzer } from './qwenEmotionAnalyzer.ts';

const MAX_WINDOW_MS = 5 * 60 * 1_000;
const MAX_WINDOW_SEGMENTS = 50;
const WINDOW_CONTEXT_MS = 1_000;
const SAFETY_POLL_INTERVAL_MS = 15_000;

/** 将连续说话轮次组合成不超过时长和数量上限的初始窗口。 */
export function buildEmotionWindows(
  segments: PostAnalysisTranscriptSegment[],
): PostAnalysisTranscriptSegment[][] {
  const windows: PostAnalysisTranscriptSegment[][] = [];
  let current: PostAnalysisTranscriptSegment[] = [];
  // 确认快照的旧数据可能没有可靠的 part_index；声学窗口必须按原始时间轴排序，避免生成负的相对时间。
  const orderedSegments = segments
    .filter(({ text }) => text.trim().length > 0)
    .slice()
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
  for (const segment of orderedSegments) {
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
  ossStaging?: AudioArtifactStore;
  resolveRuntime?: (job: ClaimedPostAnalysisJob) => Promise<PostAnalysisRuntime>;
  reporter?: AiExecutionReporter;
  liveUpdates?: LiveUpdateBroker;
  wakeup?: WorkerWakeupSource;
  onEmotionPublished?: (job: ClaimedPostAnalysisJob) => Promise<void>;
  sourceTempDirectory?: string;
};

type PostAnalysisRuntime = {
  emotionAnalyzer?: QwenEmotionAnalyzer;
  roleRecognizer?: DeepSeekRoleRecognizer;
  ossStaging?: AudioArtifactStore;
  primaryStorage?: PrimaryOssStore;
};

/** 由数据库通知优先唤醒、单并发执行一种后置分析任务。 */
export class AudioPostAnalysisWorker {
  private active?: Promise<void>;
  private pumping = false;
  private stopping = false;
  private timer?: NodeJS.Timeout;
  private unsubscribeWakeup?: () => void;
  private windowSequence = 0;

  constructor(private readonly options: WorkerOptions) {}

  /** 重新排队中断任务后订阅数据库通知，并启动低频安全扫描。 */
  async start(): Promise<void> {
    if (this.timer) return;
    this.stopping = false;
    await this.options.repository.resetInterrupted(this.options.type);
    this.unsubscribeWakeup = this.options.wakeup?.subscribe(
      this.options.type === 'emotion' ? 'audio-emotion-analysis' : 'audio-role-analysis',
      () => void this.pump(),
    );
    this.timer = setInterval(() => void this.pump(), SAFETY_POLL_INTERVAL_MS);
    this.timer.unref();
    void this.pump();
  }

  /** 停止领取并等待当前任务收敛。 */
  async stop(): Promise<void> {
    this.stopping = true;
    this.unsubscribeWakeup?.();
    this.unsubscribeWakeup = undefined;
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
      this.notify(job, false);
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

  private notify(job: ClaimedPostAnalysisJob, terminal: boolean): void {
    this.options.liveUpdates?.publish({
      kind: 'audio-analysis',
      audioFileId: job.audioFileId,
      groupId: null,
      terminal,
    });
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
      const runtime = this.options.resolveRuntime
        ? await this.options.resolveRuntime(job)
        : this.options;
      if (job.segments.length === 0) {
        throw new PostAnalysisProviderError(
          'INVALID_MODEL_OUTPUT',
          '转写中没有可分析的正文片段。',
          false,
        );
      }
      if (job.type === 'emotion') await this.executeEmotion(job, report, runtime);
      else await this.executeRole(job, report, runtime);
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
      let failurePersistenceError: unknown;
      let finalFailure = true;
      try {
        finalFailure =
          (await this.options.repository.fail(job.id, code, message, retryable)) !== false;
        this.notify(job, finalFailure);
      } catch (persistenceError) {
        // 数据库故障不得阻止模型失败报告落盘，二者各自保留诊断信号。
        failurePersistenceError = persistenceError;
      }
      await report.finish({
        status: 'failed',
        error,
        metadata: {
          code,
          retryable,
          retryScheduled: !finalFailure,
          durationMs: Date.now() - startedAt,
          failurePersistenceError,
        },
      });
      console.error('Audio post-analysis failed', {
        audioFileId: job.audioFileId,
        jobId: job.id,
        type: job.type,
        code,
        retryScheduled: !finalFailure,
      });
    } finally {
      if (job.type === 'emotion' && this.options.preprocessor) {
        await this.options.preprocessor.cleanup(job.id).catch(() => undefined);
      }
    }
  }

  private async executeRole(
    job: ClaimedPostAnalysisJob,
    report: AiExecutionRecorder,
    runtime: PostAnalysisRuntime,
  ): Promise<void> {
    if (!runtime.roleRecognizer) {
      throw new PostAnalysisProviderError('MODEL_UNAVAILABLE', '角色识别模型尚未配置。', false);
    }
    const results = await runtime.roleRecognizer.recognize(
      job.segments,
      job.customBusinessRoles,
      report,
    );
    await this.options.repository.updateProgress(job.id, 95);
    this.notify(job, false);
    await this.options.repository.publishRoles(job, results);
    this.notify(job, true);
    report.recordOutput(results);
  }

  private async executeEmotion(
    job: ClaimedPostAnalysisJob,
    report: AiExecutionRecorder,
    runtime: PostAnalysisRuntime,
  ): Promise<void> {
    if (!runtime.emotionAnalyzer || !this.options.preprocessor || !runtime.ossStaging) {
      throw new PostAnalysisProviderError(
        'MODEL_UNAVAILABLE',
        '情绪分析所需的 Qwen、OSS 或 FFmpeg 尚未完整配置。',
        false,
      );
    }
    const emotionRuntime = {
      emotionAnalyzer: runtime.emotionAnalyzer,
      ossStaging: runtime.ossStaging,
    };
    let materialized: Awaited<ReturnType<PrimaryOssStore['materialize']>> | undefined;
    if (job.storageBackend === 'aliyun_oss') {
      if (!runtime.primaryStorage || !this.options.sourceTempDirectory) {
        throw new PostAnalysisProviderError(
          'MODEL_UNAVAILABLE',
          '对象存储源音频读取能力未完整配置。',
          false,
        );
      }
      materialized = await runtime.primaryStorage.materialize(
        job.storageKey,
        path.resolve(this.options.sourceTempDirectory, 'emotion-source', job.id),
        'source-audio',
      );
    }
    this.windowSequence = 0;
    const initialWindows = buildEmotionWindows(job.segments);
    const results: EmotionPublication[] = [];
    const savedWindows = new Map(
      (job.emotionWindowResults ?? []).map((window) => [window.index, window] as const),
    );
    try {
      for (const [index, window] of initialWindows.entries()) {
        const saved = savedWindows.get(index);
        const windowResults = saved
          ? saved.results
          : await this.analyzeEmotionWindow(
              job,
              window,
              report,
              emotionRuntime,
              materialized?.path,
            );
        results.push(...windowResults);
        if (!saved && 'saveEmotionWindowResult' in this.options.repository) {
          const checkpoint: EmotionWindowResult = {
            index,
            startMs: window[0]!.startMs,
            endMs: window.at(-1)!.endMs,
            segmentIds: window.map((segment) => segment.id),
            results: windowResults,
          };
          await this.options.repository.saveEmotionWindowResult(job.id, checkpoint);
        }
        await this.options.repository.updateProgress(
          job.id,
          5 + (results.length / job.segments.length) * 88,
        );
        this.notify(job, false);
      }
    } finally {
      await materialized?.cleanup().catch(() => undefined);
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
    this.notify(job, false);
    await this.options.repository.publishEmotion(job, [...unique.values()]);
    if (this.options.onEmotionPublished) {
      try {
        await this.options.onEmotionPublished(job);
        report.recordStep({ name: 'source-cleanup', status: 'completed' });
      } catch {
        report.recordStep({ name: 'source-cleanup', status: 'failed' });
      }
    }
    this.notify(job, true);
    report.recordOutput([...unique.values()]);
  }

  private async analyzeEmotionWindow(
    job: ClaimedPostAnalysisJob,
    segments: PostAnalysisTranscriptSegment[],
    report: AiExecutionRecorder,
    runtime: Required<Pick<PostAnalysisRuntime, 'emotionAnalyzer' | 'ossStaging'>>,
    sourcePathOverride?: string,
  ): Promise<EmotionPublication[]> {
    const startMs = Math.max(0, segments[0]!.startMs - WINDOW_CONTEXT_MS);
    const endMs = Math.min(job.durationMs, segments.at(-1)!.endMs + WINDOW_CONTEXT_MS);
    this.windowSequence += 1;
    const path = await runReportedStep(
      report,
      `emotion-window-${this.windowSequence}-preprocess`,
      () =>
        this.options.preprocessor!.createWindow({
          jobId: job.id,
          storageKey: job.storageKey,
          windowIndex: this.windowSequence,
          startMs,
          endMs,
          sourcePathOverride,
        }),
    );
    const objectKey = await runReportedStep(
      report,
      `emotion-window-${this.windowSequence}-staging-upload`,
      () => runtime.ossStaging.uploadEmotionWindow(job.id, path),
    );
    try {
      return await runtime.emotionAnalyzer.analyze(
        runtime.ossStaging.signedGetUrl(objectKey),
        segments.map((segment) => ({
          ...segment,
          relativeStartMs: segment.startMs - startMs,
          relativeEndMs: segment.endMs - startMs,
        })),
        report,
        {
          windowIndex: this.windowSequence,
          startMs,
          endMs,
          segmentIds: segments.map((segment) => segment.id),
        },
      );
    } catch (error) {
      if (
        error instanceof PostAnalysisProviderError &&
        error.code === 'INVALID_MODEL_OUTPUT' &&
        segments.length > 1
      ) {
        const middle = Math.ceil(segments.length / 2);
        return [
          ...(await this.analyzeEmotionWindow(
            job,
            segments.slice(0, middle),
            report,
            runtime,
            sourcePathOverride,
          )),
          ...(await this.analyzeEmotionWindow(
            job,
            segments.slice(middle),
            report,
            runtime,
            sourcePathOverride,
          )),
        ];
      }
      throw error;
    } finally {
      await runtime.ossStaging.delete(objectKey).catch(() => {
        console.warn('Failed to clean transient emotion analysis object', { jobId: job.id });
      });
    }
  }
}
