/**
 * 知识文档入库 worker。
 *
 * 通过显式 LangGraph 流程消费可恢复的 PostgreSQL 入库任务，完成校验、解析、
 * embedding、revision 发布与临时文件清理。
 *
 * Responsibilities:
 * - 控制并发领取和执行入库任务。
 * - 推进可观察的任务阶段与失败状态。
 * - 在停止时等待当前任务安全收敛。
 *
 * Notes:
 * - PostgreSQL 通知负责低延迟唤醒，15 秒安全扫描与 SKIP LOCKED 负责遗漏恢复和并发互斥。
 * - 当前 worker 仍与 API 同进程，本地临时文件路径不支持跨主机接管。
 */
import { readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

import {
  noOpAiExecutionReporter,
  type AiExecutionReporter,
} from '../../ai-observability/executionReporter.ts';
import type { WorkerWakeupSource } from '../../infrastructure/workerWakeup.ts';
import { DocumentParseError } from './documentParser.ts';
import { EmbeddingProviderError, DashScopeEmbeddings } from '../embeddings/dashScopeEmbeddings.ts';
import {
  IngestionRepository,
  type ClaimedIngestionJob,
} from '../persistence/ingestionRepository.ts';
import { createIngestionGraph } from './graph/graph.ts';

const SAFETY_POLL_INTERVAL_MS = 15_000;

type WorkerOptions = {
  repository: IngestionRepository;
  createEmbeddings?(job: ClaimedIngestionJob): Promise<DashScopeEmbeddings>;
  embeddings?: DashScopeEmbeddings;
  embeddingModel?: string;
  uploadTempDirectory: string;
  concurrency?: number;
  reporter?: AiExecutionReporter;
  wakeup?: WorkerWakeupSource;
};

/** 管理可恢复入库任务领取、LangGraph 执行和优雅停止的后台 worker。 */
export class IngestionWorker {
  private readonly concurrency: number;
  private readonly active = new Set<Promise<void>>();
  private timer?: NodeJS.Timeout;
  private unsubscribeWakeup?: () => void;
  private stopping = false;
  private pumping = false;
  constructor(private readonly options: WorkerOptions) {
    this.concurrency = options.concurrency ?? 2;
  }

  /** 启动通知订阅、孤立文件清理和低频安全扫描；重复调用不会创建第二个 timer。 */
  start(): void {
    if (this.timer) return;
    this.stopping = false;
    this.unsubscribeWakeup = this.options.wakeup?.subscribe(
      'knowledge-ingestion',
      () => void this.pump(),
    );
    void this.cleanupOrphanedFiles();
    this.timer = setInterval(() => void this.pump(), SAFETY_POLL_INTERVAL_MS);
    this.timer.unref();
    void this.pump();
  }

  /** 停止领取新任务并等待所有活动任务完成或失败收敛。 */
  async stop(): Promise<void> {
    this.stopping = true;
    this.unsubscribeWakeup?.();
    this.unsubscribeWakeup = undefined;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await Promise.allSettled(this.active);
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (!this.stopping && this.active.size < this.concurrency) {
        let job: ClaimedIngestionJob | undefined;
        try {
          job = await this.options.repository.claimIngestionJob();
        } catch (error) {
          console.error('Failed to claim ingestion job', error);
          return;
        }
        if (!job) return;
        const execution = this.execute(job).finally(() => {
          this.active.delete(execution);
          if (!this.stopping) void this.pump();
        });
        this.active.add(execution);
      }
    } finally {
      this.pumping = false;
    }
  }

  private async execute(job: ClaimedIngestionJob): Promise<void> {
    const embeddingModel = job.embeddingModel ?? this.options.embeddingModel;
    if (!embeddingModel) throw new Error('Ingestion embedding model is unavailable.');
    const startedAt = Date.now();
    const report = (this.options.reporter ?? noOpAiExecutionReporter).start({
      kind: 'knowledge-ingestion',
      name: 'EchoWave knowledge ingestion',
      metadata: {
        jobId: job.id,
        knowledgeBaseId: job.knowledgeBaseId,
        documentId: job.documentId,
        revisionId: job.revisionId,
        format: job.format,
        sizeBytes: job.sizeBytes,
        attempt: job.attempts,
        embeddingModel,
      },
    });
    try {
      const embeddings = this.options.createEmbeddings
        ? await this.options.createEmbeddings(job)
        : this.options.embeddings;
      if (!embeddings) throw new Error('Ingestion embeddings are unavailable.');
      const graph = createIngestionGraph({
        repository: this.options.repository,
        embeddings,
        embeddingModel,
      });
      await graph.invoke({ job, report });
      const durationMs = Date.now() - startedAt;
      report.recordOutput({ status: 'completed', documentId: job.documentId });
      await report.finish({
        status: 'completed',
        metadata: { durationMs },
      });
      console.info('Ingestion completed', {
        jobId: job.id,
        documentId: job.documentId,
        durationMs,
      });
    } catch (error) {
      const known = error instanceof DocumentParseError || error instanceof EmbeddingProviderError;
      const code = known ? error.code : 'INTERNAL_ERROR';
      const retryable = error instanceof EmbeddingProviderError || (!known && job.attempts < 3);
      const message = known ? error.message : '文档处理失败，请稍后重试。';
      const failurePersistenceStartedAt = Date.now();
      report.recordStep({ name: 'persist-failure', status: 'started' });
      try {
        await this.options.repository.failJob(job, code, message, retryable);
        report.recordStep({
          name: 'persist-failure',
          status: 'completed',
          durationMs: Date.now() - failurePersistenceStartedAt,
        });
      } catch (persistenceError) {
        report.recordStep({
          name: 'persist-failure',
          status: 'failed',
          durationMs: Date.now() - failurePersistenceStartedAt,
        });
        await report.finish({
          status: 'failed',
          error,
          metadata: {
            code,
            retryable,
            failurePersistenceError:
              persistenceError instanceof Error ? persistenceError.name : 'UnknownError',
          },
        });
        throw persistenceError;
      }
      if (!retryable) await unlink(job.stagedPath).catch(() => undefined);
      await report.finish({
        status: 'failed',
        error,
        metadata: { code, retryable, durationMs: Date.now() - startedAt },
      });
      console.error('Ingestion failed', {
        jobId: job.id,
        documentId: job.documentId,
        code,
        retryable,
      });
    }
  }

  private async cleanupOrphanedFiles(): Promise<void> {
    const directory = path.resolve(this.options.uploadTempDirectory);
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    await Promise.all(
      entries
        .filter((entry) => entry.isFile())
        .map(async (entry) => {
          const filePath = path.join(directory, entry.name);
          const details = await stat(filePath).catch(() => undefined);
          if (details && details.mtimeMs < cutoff) await unlink(filePath).catch(() => undefined);
        }),
    );
  }
}
