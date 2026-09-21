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
import { readFile } from 'node:fs/promises';
import type { ClassificationSuggestion } from '@echowave/contracts';
import type { AiExecutionRecorder } from '../../../ai-observability/executionReporter.ts';
import type {
  ClaimedIngestionJob,
  IngestionRepository,
} from '../../persistence/ingestionRepository.ts';
import type { ParsedDocument } from '../documentParser.ts';

import { runReportedStep } from '../../../ai-runtime/reportedStep.ts';
import type { DashScopeEmbeddings } from '../../embeddings/dashScopeEmbeddings.ts';
import { DocumentParseError, parseKnowledgeDocument } from '../documentParser.ts';
import { normalizeParsedDocumentSnapshot } from '../parserTypes.ts';

const MAX_FILE_BYTES = 20 * 1024 * 1024;

export type IngestionNodeOptions = {
  suggestCategories?: (
    job: ClaimedIngestionJob,
    parsed: ParsedDocument,
    report: AiExecutionRecorder,
  ) => Promise<ClassificationSuggestion>;
  repository: IngestionRepository;
  embeddings: DashScopeEmbeddings;
  embeddingModel: string;
};

/** 创建由 graph 直接引用的命名入库节点。 */
export function createIngestionNodes(options: IngestionNodeOptions) {
  /** 分类失败不能阻断原有解析与向量发布。 */
  async function classifyNode({ job, parsed, report }: any) {
    if (job.caseId || !options.suggestCategories) return {};
    if (job.categorySuggestion) return { categorySuggestion: job.categorySuggestion };
    let categorySuggestion: ClassificationSuggestion;
    try {
      categorySuggestion = await options.suggestCategories(job, parsed, report);
    } catch {
      categorySuggestion = {
        status: 'failed',
        documentCategoryId: null,
        sheets: [],
        message: '类别建议暂时不可用，已保留继承分类，可重试。',
      };
    }
    await options.repository.saveIngestionSuggestion?.(job, categorySuggestion);
    return { categorySuggestion };
  }
  async function validateNode({ job, report }: any) {
    const source = await runReportedStep(
      report,
      'validate',
      async () => {
        await options.repository.setJobStage(job, 'validate', 'validating');
        if (job.rebuildSnapshot) return Buffer.alloc(0);
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
        return job.rebuildSnapshot
          ? normalizeParsedDocumentSnapshot(job.rebuildSnapshot)
          : parseKnowledgeDocument(source, job.format, job.title);
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

  async function publishNode({ job, parsed, embedding, report, categorySuggestion }: any) {
    await runReportedStep(
      report,
      'publish',
      () =>
        options.repository.publishRevision({
          categorySuggestion,
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

  /** 原文件由版本清理任务持有，不在成功解析后删除。 */
  async function cleanupNode({ job, report }: any) {
    await runReportedStep(
      report,
      'cleanup',
      async () => ({ retained: true, revisionId: job.revisionId }),
      (result) => result,
    );
    return {};
  }

  return {
    classifyNode,
    validateNode,
    parseNode,
    normalizeNode,
    chunkNode,
    embedNode,
    publishNode,
    cleanupNode,
  };
}
