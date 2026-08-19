/** Runs the resumable PostgreSQL ingestion queue through an explicit LangGraph pipeline. */
import { readFile, readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

import { Annotation, END, START, StateGraph } from '@langchain/langgraph';

import { DocumentParseError, parseKnowledgeDocument, type ParsedDocument } from './documentParser.ts';
import { EmbeddingProviderError, OpenRouterEmbeddings, type EmbeddingBatchResult } from './openRouterEmbeddings.ts';
import { RagRepository, type ClaimedIngestionJob } from './repository.ts';

const MAX_FILE_BYTES = 20 * 1024 * 1024;

const IngestionState = Annotation.Root({
  job: Annotation<ClaimedIngestionJob>(),
  source: Annotation<Buffer>(),
  parsed: Annotation<ParsedDocument>(),
  embedding: Annotation<EmbeddingBatchResult>(),
});

type WorkerOptions = {
  repository: RagRepository;
  embeddings: OpenRouterEmbeddings;
  embeddingModel: string;
  uploadTempDirectory: string;
  concurrency?: number;
};

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
      .addNode('validate', async ({ job }) => {
        await options.repository.setJobStage(job, 'validate', 'validating');
        const source = await readFile(job.stagedPath);
        if (source.byteLength !== job.sizeBytes || source.byteLength > MAX_FILE_BYTES) {
          throw new DocumentParseError('DOCUMENT_TOO_LARGE', '文件超过 20 MB 或上传内容不完整。');
        }
        return { source };
      })
      .addNode('parse', async ({ job, source }) => {
        await options.repository.setJobStage(job, 'parse', 'parsing');
        return { parsed: await parseKnowledgeDocument(source, job.format, job.title) };
      })
      .addNode('normalize', async ({ job }) => {
        await options.repository.setJobStage(job, 'normalize', 'parsing');
        return {};
      })
      .addNode('chunk', async ({ job }) => {
        await options.repository.setJobStage(job, 'chunk', 'chunking');
        return {};
      })
      .addNode('embed', async ({ job, parsed }) => {
        await options.repository.setJobStage(job, 'embed', 'embedding', 5);
        const embedding = await options.embeddings.embedBatches(parsed.chunks.map((chunk) => chunk.embeddingText));
        await options.repository.setJobStage(job, 'embed', 'embedding', 95);
        return { embedding };
      })
      .addNode('publish', async ({ job, parsed, embedding }) => {
        await options.repository.publishRevision({
          job,
          chunks: parsed.chunks,
          vectors: embedding.vectors,
          previewText: parsed.previewText,
          warnings: parsed.warnings,
          provider: embedding.provider,
          embeddingTokens: embedding.tokens,
          estimatedCostUsd: embedding.estimatedCostUsd,
          embeddingModel: options.embeddingModel,
        });
        return {};
      })
      .addNode('cleanup', async ({ job }) => {
        await unlink(job.stagedPath).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') console.warn('Failed to remove staged upload', { jobId: job.id });
        });
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

  start(): void {
    if (this.timer) return;
    this.stopping = false;
    void this.cleanupOrphanedFiles();
    this.timer = setInterval(() => void this.pump(), 750);
    this.timer.unref();
    void this.pump();
  }

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
    try {
      await this.graph.invoke({ job });
      console.info('Ingestion completed', { jobId: job.id, documentId: job.documentId, durationMs: Date.now() - startedAt });
    } catch (error) {
      const known = error instanceof DocumentParseError || error instanceof EmbeddingProviderError;
      const code = known ? error.code : 'INTERNAL_ERROR';
      const retryable = error instanceof EmbeddingProviderError || (!known && job.attempts < 3);
      const message = known ? error.message : '文档处理失败，请稍后重试。';
      await this.options.repository.failJob(job, code, message, retryable);
      if (!retryable) await unlink(job.stagedPath).catch(() => undefined);
      console.error('Ingestion failed', { jobId: job.id, documentId: job.documentId, code, retryable });
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
