/**
 * 分组销售复盘后台 Worker。
 *
 * 领取版本化任务并交给持久化 LangGraph 工作流；可重试失败使用同一 thread 按有限退避恢复，
 * 终态后尽力删除 checkpoint，业务任务表和安全执行审计继续承担长期历史职责。
 *
 * Responsibilities:
 * - 编排任务领取、持久化恢复、终态通知和 checkpoint 补偿清理。
 * - 将供应商失败映射为安全、有限预算的任务错误。
 *
 * Notes:
 * - Worker 不修改 ASR、确认转写或后置识别结果。
 * - PostgreSQL 通知负责低延迟唤醒，15 秒安全扫描负责到期重试与通知遗漏恢复。
 */
import {
  noOpAiExecutionReporter,
  type AiExecutionReporter,
} from '../../../ai-observability/executionReporter.ts';
import type { LiveUpdateBroker } from '../../../infrastructure/liveUpdateBroker.ts';
import type { WorkerWakeupSource } from '../../../infrastructure/workerWakeup.ts';
import type { BusinessAnalysisRepository, ClaimedBusinessAnalysisJob } from './repository.ts';
import { BUSINESS_ANALYSIS_MAX_RECOVERY_ATTEMPTS } from './repository.ts';
import { BusinessAnalysisProviderError } from './salesAnalysisAgent.ts';
import type { BusinessAnalysisWorkflow } from './workflow.ts';

export { buildBusinessRetrievalQueries } from './workflow.ts';

const SAFETY_POLL_INTERVAL_MS = 15_000;
const RECOVERY_DELAYS_MS = [15_000, 60_000] as const;

type BusinessAnalysisWorkerOptions = {
  repository: BusinessAnalysisRepository;
  reporter?: AiExecutionReporter;
  liveUpdates?: LiveUpdateBroker;
  wakeup?: WorkerWakeupSource;
} & (
  | {
      workflow: BusinessAnalysisWorkflow;
      createWorkflow?: never;
      deleteCheckpoint?: never;
    }
  | {
      workflow?: never;
      createWorkflow: (job: ClaimedBusinessAnalysisJob) => Promise<BusinessAnalysisWorkflow>;
      deleteCheckpoint: (
        job: Pick<ClaimedBusinessAnalysisJob, 'id' | 'workflowVersion'>,
      ) => Promise<void>;
    }
);

/** 由数据库通知优先唤醒、单并发执行销售复盘任务。 */
export class BusinessAnalysisWorker {
  private active?: Promise<void>;
  private pumping = false;
  private stopping = false;
  private timer?: NodeJS.Timeout;
  private unsubscribeWakeup?: () => void;

  constructor(private readonly options: BusinessAnalysisWorkerOptions) {}

  async start(): Promise<void> {
    if (this.timer) return;
    this.stopping = false;
    await this.options.repository.resetInterrupted();
    await this.cleanupTerminalCheckpoints();
    this.unsubscribeWakeup = this.options.wakeup?.subscribe(
      'audio-business-analysis',
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
      console.error('Failed to claim business analysis job', {
        error: error instanceof Error ? error.name : 'UnknownError',
      });
    } finally {
      this.pumping = false;
    }
  }

  private notify(job: ClaimedBusinessAnalysisJob, terminal: boolean): void {
    this.options.liveUpdates?.publish({
      kind: 'audio-analysis',
      audioFileId: job.audioFileId,
      groupId: job.groupId,
      terminal,
    });
  }

  private async execute(job: ClaimedBusinessAnalysisJob) {
    const startedAt = Date.now();
    const report = (this.options.reporter ?? noOpAiExecutionReporter).start({
      kind: 'audio-business-analysis',
      name: 'EchoWave sales conversation review',
      metadata: {
        audioFileId: job.audioFileId,
        groupId: job.groupId,
        jobId: job.id,
        revisionId: job.revisionId,
        confirmationId: job.confirmationId,
        confirmationVersion: job.confirmationVersion,
        model: job.model,
        segmentCount: job.segments.length,
        knowledgeBaseIds: job.knowledgeBaseIds,
        settingsSnapshot: job.settings,
        workflowVersion: job.workflowVersion,
        recoveryAttempt: job.recoveryAttempts,
      },
    });
    try {
      const workflow = this.options.createWorkflow
        ? await this.options.createWorkflow(job)
        : this.options.workflow;
      const result = await workflow.run(job, report, () => this.notify(job, false));
      this.notify(job, true);
      report.recordOutput(result.publication);
      await report.finish({
        status: 'completed',
        metadata: {
          durationMs: Date.now() - startedAt,
          retrievedChunkCount: result.retrievedChunks.length,
          tagCount: result.publication.tags.length,
          resumedFromCheckpoint: result.resumed,
          workflowVersion: job.workflowVersion,
          recoveryAttempt: job.recoveryAttempts,
        },
      });
      await this.cleanupCheckpoint(job);
    } catch (error) {
      const known = error instanceof BusinessAnalysisProviderError;
      const code = known ? error.code : 'INTERNAL_ERROR';
      const retryable = known ? error.retryable : true;
      const reason = known ? error.reason : 'other';
      const message = known ? error.message : '销售复盘失败，请稍后重试。';
      let willRetry = false;
      let failurePersistenceError: unknown;
      try {
        if (retryable && job.recoveryAttempts < BUSINESS_ANALYSIS_MAX_RECOVERY_ATTEMPTS) {
          const delayMs = RECOVERY_DELAYS_MS[job.recoveryAttempts] ?? RECOVERY_DELAYS_MS[1];
          willRetry = await this.options.repository.scheduleRecovery(
            job.id,
            code,
            message,
            delayMs,
          );
        }
        if (!willRetry) {
          await this.options.repository.fail(job.id, code, message, retryable);
        }
        this.notify(job, !willRetry);
      } catch (persistenceError) {
        // 报告是故障诊断旁路；任务状态写入异常时仍须尽力落盘原始分析错误。
        failurePersistenceError = persistenceError;
      }
      report.recordStep({
        name: 'workflow-recovery-decision',
        status: failurePersistenceError ? 'failed' : 'completed',
        metadata: {
          recoveryAttempt: job.recoveryAttempts,
          nextRecoveryAttempt: willRetry ? job.recoveryAttempts + 1 : null,
          willRetry,
          retryable,
        },
      });
      await report.finish({
        status: 'failed',
        error,
        metadata: {
          code,
          retryable,
          reason,
          willRetry,
          recoveryAttempt: job.recoveryAttempts,
          nextRecoveryAttempt: willRetry ? job.recoveryAttempts + 1 : null,
          durationMs: Date.now() - startedAt,
          failurePersistenceError,
        },
      });
      if (!willRetry && !failurePersistenceError) await this.cleanupCheckpoint(job);
      console.error('Business analysis failed', {
        audioFileId: job.audioFileId,
        groupId: job.groupId,
        jobId: job.id,
        code,
        retryable,
        willRetry,
        message,
        failurePersistenceError:
          failurePersistenceError instanceof Error ? failurePersistenceError.name : undefined,
      });
    }
  }

  private async cleanupCheckpoint(
    job: Pick<ClaimedBusinessAnalysisJob, 'id' | 'workflowVersion'>,
  ): Promise<void> {
    try {
      if (this.options.createWorkflow) await this.options.deleteCheckpoint(job);
      else await this.options.workflow.deleteCheckpoint(job);
      await this.options.repository.markCheckpointCleaned(job.id);
    } catch (error) {
      console.error('Failed to clean business analysis checkpoint', {
        jobId: job.id,
        error: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }

  private async cleanupTerminalCheckpoints(): Promise<void> {
    try {
      const candidates = await this.options.repository.listCheckpointCleanupCandidates();
      for (const candidate of candidates) await this.cleanupCheckpoint(candidate);
    } catch (error) {
      // 清理失败不能阻断业务 Worker 启动；终态标记会让后续启动继续补偿。
      console.error('Failed to list business analysis checkpoints for cleanup', {
        error: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }
}
