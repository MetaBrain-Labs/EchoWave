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
 * - 当前 worker 与 API 同进程，尚不支持多实例协调。
 */
import { readFile, readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

import { Annotation, END, START, StateGraph } from '@langchain/langgraph';

import {
  noOpAiExecutionReporter,
  type AiExecutionRecorder,
  type AiExecutionReporter,
} from '../../ai-observability/executionReporter.ts';
import {
  DocumentParseError,
  parseKnowledgeDocument,
  type ParsedDocument,
} from './documentParser.ts';
import {
  EmbeddingProviderError,
  DashScopeEmbeddings,
  type EmbeddingBatchResult,
} from '../embeddings/dashScopeEmbeddings.ts';
import {
  IngestionRepository,
  type ClaimedIngestionJob,
} from '../persistence/ingestionRepository.ts';

const MAX_FILE_BYTES = 20 * 1024 * 1024;

const IngestionState = Annotation.Root({
  job: Annotation<ClaimedIngestionJob>(),
  source: Annotation<Buffer>(),
  parsed: Annotation<ParsedDocument>(),
  embedding: Annotation<EmbeddingBatchResult>(),
  report: Annotation<AiExecutionRecorder>(),
});

type WorkerOptions = {
  repository: IngestionRepository;
  embeddings: DashScopeEmbeddings;
  embeddingModel: string;
  uploadTempDirectory: string;
  concurrency?: number;
  reporter?: AiExecutionReporter;
};

async function runReportedStep<T>(
  report: AiExecutionRecorder,
  name: string,
  operation: () => Promise<T>,
  summarize?: (result: T) => Record<string, unknown>,
): Promise<T> {
  const startedAt = Date.now();
  report.recordStep({ name, status: 'started' });
  try {
    const result = await operation();
    report.recordStep({
      name,
      status: 'completed',
      durationMs: Date.now() - startedAt,
      metadata: summarize?.(result),
    });
    return result;
  } catch (error) {
    report.recordStep({
      name,
      status: 'failed',
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}

/** 管理可恢复入库任务领取、LangGraph 执行和优雅停止的后台 worker。 */
export class IngestionWorker {
  private readonly concurrency: number;
  private readonly active = new Set<Promise<void>>();
  private timer?: NodeJS.Timeout;
  private stopping = false;
  private pumping = false;
  private readonly graph;

  constructor(private readonly options: WorkerOptions) {
    this.concurrency = options.concurrency ?? 2;
    this.graph = new StateGraph(IngestionState)
      .addNode('validate', async ({ job, report }) => {
        const source = await runReportedStep(
          report,
          'validate',
          async () => {
            await options.repository.setJobStage(job, 'validate', 'validating');
            const value = await readFile(job.stagedPath);
            if (value.byteLength !== job.sizeBytes || value.byteLength > MAX_FILE_BYTES) {
              throw new DocumentParseError(
                'DOCUMENT_TOO_LARGE',
                '文件超过 20 MB 或上传内容不完整。',
              );
            }
            return value;
          },
          (value) => ({ sizeBytes: value.byteLength }),
        );
        return { source };
      })
      .addNode('parse', async ({ job, source, report }) => {
        const parsed = await runReportedStep(
          report,
          'parse',
          async () => {
            await options.repository.setJobStage(job, 'parse', 'parsing');
            return parseKnowledgeDocument(source, job.format, job.title);
          },
          (value) => ({
            chunkCount: value.chunks.length,
            warningCount: value.warnings.length,
            previewLength: value.previewText.length,
          }),
        );
        report.recordContext({
          title: job.title,
          previewText: parsed.previewText,
          warnings: parsed.warnings,
          chunks: parsed.chunks,
        });
        return { parsed };
      })
      .addNode('normalize', async ({ job, report }) => {
        await runReportedStep(report, 'normalize', () =>
          options.repository.setJobStage(job, 'normalize', 'parsing'),
        );
        return {};
      })
      .addNode('chunk', async ({ job, parsed, report }) => {
        await runReportedStep(
          report,
          'chunk',
          () => options.repository.setJobStage(job, 'chunk', 'chunking'),
          () => ({ chunkCount: parsed.chunks.length }),
        );
        return {};
      })
      .addNode('embed', async ({ job, parsed, report }) => {
        const embedding = await runReportedStep(
          report,
          'embed',
          async () => {
            await options.repository.setJobStage(job, 'embed', 'embedding', 5);
            const modelStartedAt = Date.now();
            let result;
            try {
              result = await options.embeddings.embedBatches(
                parsed.chunks.map((chunk) => chunk.embeddingText),
              );
              report.recordModelCall({
                name: 'document-embedding',
                provider: result.provider,
                model: result.model,
                status: 'completed',
                attempt: 1,
                durationMs: Date.now() - modelStartedAt,
                inputTokens: result.tokens,
                outputTokens: null,
                estimatedCost: result.estimatedCost,
                input: {
                  kind: 'embedding',
                  texts: parsed.chunks.map((chunk) => chunk.embeddingText),
                },
                output: {
                  vectorCount: result.vectors.length,
                  dimensions: result.vectors[0]?.length ?? 0,
                  tokens: result.tokens,
                  estimatedCost: result.estimatedCost,
                },
                metadata: {
                  inputCount: parsed.chunks.length,
                  vectorCount: result.vectors.length,
                  dimensions: result.vectors[0]?.length ?? 0,
                },
              });
            } catch (error) {
              report.recordModelCall({
                name: 'document-embedding',
                provider: 'dashscope',
                model: options.embeddingModel,
                status: 'failed',
                attempt: 1,
                durationMs: Date.now() - modelStartedAt,
                inputTokens: null,
                outputTokens: null,
                input: {
                  kind: 'embedding',
                  texts: parsed.chunks.map((chunk) => chunk.embeddingText),
                },
                output: { error },
                metadata: { inputCount: parsed.chunks.length },
              });
              throw error;
            }
            await options.repository.setJobStage(job, 'embed', 'embedding', 95);
            return result;
          },
          (value) => ({
            provider: value.provider,
            model: value.model,
            tokens: value.tokens,
            estimatedCost: value.estimatedCost,
            vectorCount: value.vectors.length,
          }),
        );
        return { embedding };
      })
      .addNode('publish', async ({ job, parsed, embedding, report }) => {
        await runReportedStep(
          report,
          'publish',
          () =>
            options.repository.publishRevision({
              job,
              chunks: parsed.chunks,
              vectors: embedding.vectors,
              previewText: parsed.previewText,
              warnings: parsed.warnings,
              provider: embedding.provider,
              embeddingTokens: embedding.tokens,
              estimatedCost: embedding.estimatedCost,
              embeddingModel: options.embeddingModel,
            }),
          () => ({
            revisionId: job.revisionId,
            chunkCount: parsed.chunks.length,
            warningCount: parsed.warnings.length,
          }),
        );
        return {};
      })
      .addNode('cleanup', async ({ job, report }) => {
        await runReportedStep(
          report,
          'cleanup',
          async () =>
            unlink(job.stagedPath).then(
              () => ({ removed: true }),
              (error: NodeJS.ErrnoException) => {
                if (error.code !== 'ENOENT')
                  console.warn('Failed to remove staged upload', { jobId: job.id });
                return {
                  removed: false,
                  reason: error.code === 'ENOENT' ? 'already-missing' : 'unlink-failed',
                };
              },
            ),
          (result) => result,
        );
        return {};
      })
      .addEdge(START, 'validate')
      .addEdge('validate', 'parse')
      .addEdge('parse', 'normalize')
      .addEdge('normalize', 'chunk')
      .addEdge('chunk', 'embed')
      .addEdge('embed', 'publish')
      .addEdge('publish', 'cleanup')
      .addEdge('cleanup', END)
      .compile();
  }

  /** 启动孤立文件清理和周期任务领取；重复调用不会创建第二个 timer。 */
  start(): void {
    if (this.timer) return;
    this.stopping = false;
    void this.cleanupOrphanedFiles();
    this.timer = setInterval(() => void this.pump(), 750);
    this.timer.unref();
    void this.pump();
  }

  /** 停止领取新任务并等待所有活动任务完成或失败收敛。 */
  async stop(): Promise<void> {
    this.stopping = true;
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
        const execution = this.execute(job).finally(() => this.active.delete(execution));
        this.active.add(execution);
      }
    } finally {
      this.pumping = false;
    }
  }

  private async execute(job: ClaimedIngestionJob): Promise<void> {
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
        embeddingModel: this.options.embeddingModel,
      },
    });
    try {
      await this.graph.invoke({ job, report });
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
