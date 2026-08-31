/**
 * 知识入库 LangGraph 节点。
 *
 * 实现校验、解析、阶段推进、向量化、发布和清理节点，供图构造器按名称引用。
 *
 * Responsibilities:
 * - 在每个节点维护任务阶段和执行审计。
 * - 保持文件大小、模型报告、发布与清理语义。
 *
 * Notes:
 * - 节点依赖由工厂显式注入，不从组合根或全局配置读取。
 */
import { readFile, unlink } from 'node:fs/promises';

import { runReportedStep } from '../../../ai-runtime/reportedStep.ts';
import type { DashScopeEmbeddings } from '../../embeddings/dashScopeEmbeddings.ts';
import type { IngestionRepository } from '../../persistence/ingestionRepository.ts';
import { DocumentParseError, parseKnowledgeDocument } from '../documentParser.ts';

const MAX_FILE_BYTES = 20 * 1024 * 1024;

export type IngestionNodeOptions = {
  repository: IngestionRepository;
  embeddings: DashScopeEmbeddings;
  embeddingModel: string;
};

/** 创建由 graph 直接引用的命名入库节点。 */
export function createIngestionNodes(options: IngestionNodeOptions) {
  async function validateNode({ job, report }: any) {
    const source = await runReportedStep(
      report,
      'validate',
      async () => {
        await options.repository.setJobStage(job, 'validate', 'validating');
        const value = await readFile(job.stagedPath);
        if (value.byteLength !== job.sizeBytes || value.byteLength > MAX_FILE_BYTES) {
          throw new DocumentParseError('DOCUMENT_TOO_LARGE', '文件超过 20 MB 或上传内容不完整。');
        }
        return value;
      },
      (value) => ({ sizeBytes: value.byteLength }),
    );
    return { source };
  }

  async function parseNode({ job, source, report }: any) {
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
  }

  async function normalizeNode({ job, report }: any) {
    await runReportedStep(report, 'normalize', () =>
      options.repository.setJobStage(job, 'normalize', 'parsing'),
    );
    return {};
  }

  async function chunkNode({ job, parsed, report }: any) {
    await runReportedStep(
      report,
      'chunk',
      () => options.repository.setJobStage(job, 'chunk', 'chunking'),
      () => ({ chunkCount: parsed.chunks.length }),
    );
    return {};
  }

  async function embedNode({ job, parsed, report }: any) {
    const embedding = await runReportedStep(
      report,
      'embed',
      async () => {
        await options.repository.setJobStage(job, 'embed', 'embedding', 5);
        const modelStartedAt = Date.now();
        let result;
        try {
          result = await options.embeddings.embedBatches(
            parsed.chunks.map((chunk: { embeddingText: string }) => chunk.embeddingText),
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
              texts: parsed.chunks.map((chunk: { embeddingText: string }) => chunk.embeddingText),
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
              texts: parsed.chunks.map((chunk: { embeddingText: string }) => chunk.embeddingText),
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
  }

  async function publishNode({ job, parsed, embedding, report }: any) {
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
  }

  async function cleanupNode({ job, report }: any) {
    await runReportedStep(
      report,
      'cleanup',
      async () =>
        unlink(job.stagedPath).then(
          () => ({ removed: true }),
          (error: NodeJS.ErrnoException) => {
            if (error.code !== 'ENOENT') {
              console.warn('Failed to remove staged upload', { jobId: job.id });
            }
            return {
              removed: false,
              reason: error.code === 'ENOENT' ? 'already-missing' : 'unlink-failed',
            };
          },
        ),
      (result) => result,
    );
    return {};
  }

  return {
    validateNode,
    parseNode,
    normalizeNode,
    chunkNode,
    embedNode,
    publishNode,
    cleanupNode,
  };
}
