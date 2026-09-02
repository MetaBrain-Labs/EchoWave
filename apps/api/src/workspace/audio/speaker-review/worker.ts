/**
 * 说话人疑点复核后台 Worker。
 *
 * 独立于 ASR 发布运行文本复核，失败只形成 partial 状态，不撤销可用转写。
 *
 * Responsibilities:
 * - 单并发领取复核任务并解析冻结的能力绑定。
 * - 发布合法模型发现或安全收敛失败。
 */
import {
  noOpAiExecutionReporter,
  type AiExecutionReporter,
} from '../../../ai-observability/executionReporter.ts';
import type { LiveUpdateBroker } from '../../../infrastructure/liveUpdateBroker.ts';
import type { WorkerWakeupSource } from '../../../infrastructure/workerWakeup.ts';
import { PostAnalysisProviderError } from '../post-analysis/qwenEmotionAnalyzer.ts';
import type { DeepSeekSpeakerReviewer } from './deepSeekSpeakerReviewer.ts';
import { type ClaimedSpeakerReviewJob, SpeakerReviewRepository } from './repository.ts';

const SAFETY_POLL_INTERVAL_MS = 15_000;

type SpeakerReviewRuntime = { reviewer: DeepSeekSpeakerReviewer };

type WorkerOptions = {
  repository: SpeakerReviewRepository;
  resolveRuntime: (job: ClaimedSpeakerReviewJob) => Promise<SpeakerReviewRuntime>;
  reporter?: AiExecutionReporter;
  liveUpdates?: LiveUpdateBroker;
  wakeup?: WorkerWakeupSource;
};

/** 由数据库通知优先唤醒的单并发说话人复核 Worker。 */
export class SpeakerReviewWorker {
  private active?: Promise<void>;
  private pumping = false;
  private stopping = false;
  private timer?: NodeJS.Timeout;
  private unsubscribeWakeup?: () => void;

  constructor(private readonly options: WorkerOptions) {}

  async start(): Promise<void> {
    if (this.timer) return;
    this.stopping = false;
    await this.options.repository.resetInterrupted();
    this.unsubscribeWakeup = this.options.wakeup?.subscribe(
      'audio-speaker-review',
      () => void this.pump(),
    );
    this.timer = setInterval(() => void this.pump(), SAFETY_POLL_INTERVAL_MS);
    this.timer.unref();
    void this.pump();
  }

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
      const job = await this.options.repository.claim();
      if (!job) return;
      this.notify(job, false);
      const execution = this.execute(job).finally(() => {
        if (this.active === execution) this.active = undefined;
        if (!this.stopping) void this.pump();
      });
      this.active = execution;
    } catch (error) {
      console.error('Failed to claim speaker review job', {
        error: error instanceof Error ? error.name : 'UnknownError',
      });
    } finally {
      this.pumping = false;
    }
  }

  private notify(job: ClaimedSpeakerReviewJob, terminal: boolean): void {
    this.options.liveUpdates?.publish({
      kind: 'audio-analysis',
      audioFileId: job.audioFileId,
      groupId: null,
      terminal,
    });
  }

  private async execute(job: ClaimedSpeakerReviewJob): Promise<void> {
    const report = (this.options.reporter ?? noOpAiExecutionReporter).start({
      kind: 'audio-speaker-review',
      name: 'EchoWave speaker boundary review',
      metadata: {
        audioFileId: job.audioFileId,
        revisionId: job.revisionId,
        jobId: job.id,
        model: job.model,
        segmentCount: job.segments.length,
      },
    });
    const startedAt = Date.now();
    try {
      const runtime = await this.options.resolveRuntime(job);
      const findings = await runtime.reviewer.review(job.segments, report);
      await this.options.repository.publish(job, findings);
      await report.finish({
        status: 'completed',
        metadata: { durationMs: Date.now() - startedAt, findingCount: findings.length },
      });
    } catch (error) {
      const known = error instanceof PostAnalysisProviderError;
      await this.options.repository.fail(
        job.id,
        known ? error.code : 'INTERNAL_ERROR',
        known ? error.message : '说话人智能复核未完成。',
      );
      await report.finish({
        status: 'failed',
        error: {
          code: known ? error.code : 'INTERNAL_ERROR',
          message: known ? error.message : '说话人智能复核未完成。',
          retryable: known ? error.retryable : true,
        },
        metadata: { durationMs: Date.now() - startedAt },
      });
    } finally {
      this.notify(job, true);
    }
  }
}
