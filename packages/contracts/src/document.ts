/**
 * 知识文档网络契约。
 *
 * 定义文档格式、处理状态、来源定位、文本块和上传响应。
 *
 * Responsibilities:
 * - 约束文档从入库到完成的可观察状态。
 * - 保留不同格式可追溯的原文定位。
 *
 * Notes:
 * - 公开版本标识及任务状态，向量和物理存储键保持内部。
 */
import { z } from 'zod';

import { EntityIdSchema } from './common.ts';

/** 知识文档支持的文件格式 schema。 */
export const DocumentFormatSchema = z.enum(['markdown', 'word', 'spreadsheet']);
/** 文档从排队到完成、失败或删除的可观察状态 schema。 */
export const DocumentStatusSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('queued') }),
  z.object({ kind: z.literal('validating') }),
  z.object({ kind: z.literal('parsing') }),
  z.object({ kind: z.literal('chunking') }),
  z.object({ kind: z.literal('embedding'), progress: z.number().min(0).max(100) }),
  z.object({ kind: z.literal('ready'), parsedAt: z.string().datetime() }),
  z.object({
    kind: z.literal('failed'),
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
  }),
  z.object({ kind: z.literal('deleting') }),
  z.object({ kind: z.literal('deleted') }),
]);

export const MarkdownLocatorSchema = z.object({
  kind: z.literal('markdown'),
  headingPath: z.array(z.string()),
  lineStart: z.number().int().positive(),
  lineEnd: z.number().int().positive(),
});
export const WordLocatorSchema = z.object({
  kind: z.literal('word'),
  headingPath: z.array(z.string()),
  paragraphStart: z.number().int().positive(),
  paragraphEnd: z.number().int().positive(),
});
export const SpreadsheetLocatorSchema = z.object({
  kind: z.literal('spreadsheet'),
  sheet: z.string(),
  rowStart: z.number().int().positive(),
  rowEnd: z.number().int().positive(),
});
/** 三种文档格式可追溯原文位置的联合 schema。 */
export const SourceLocatorSchema = z.discriminatedUnion('kind', [
  MarkdownLocatorSchema,
  WordLocatorSchema,
  SpreadsheetLocatorSchema,
]);

/** 引用来源当前生命周期；快照本身不会随原文变化。 */
export const CitationSourceStatusSchema = z.enum([
  'active',
  'superseded',
  'deleted',
  'unavailable',
]);
/** 引用快照的兼容扩展，旧客户端可以继续使用 excerpt。 */
export const CitationSnapshotFields = {
  revisionId: EntityIdSchema.nullable().optional(),
  quoteSnapshot: z.string().optional(),
  sourceStatus: CitationSourceStatusSchema.optional(),
};
/** 查询来源状态的响应，不提供已删除正文。 */
export const CitationSourceResponseSchema = z.object({ status: CitationSourceStatusSchema });
/** 文档改名必须声明读取时的版本，避免覆盖其他请求。 */
export const DocumentRenameRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(255),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();
/** 替换文件的 multipart 元信息。 */
export const DocumentReplacementRequestSchema = z.object({
  expectedVersion: z
    .union([z.number(), z.string().regex(/^\d+$/).transform(Number)])
    .pipe(z.number().int().nonnegative()),
  title: z.string().trim().min(1).max(255).optional(),
});

/** 可独立检索和引用的文档块 schema。 */
export const DocumentChunkSchema = z.object({
  id: EntityIdSchema,
  index: z.number().int().positive(),
  title: z.string(),
  content: z.string(),
  charCount: z.number().int().nonnegative(),
  vectorId: z.string(),
  locator: SourceLocatorSchema,
  sourceExcerpt: z.string(),
});
/** 知识文档列表记录 schema。 */
export const KnowledgeDocumentSchema = z.object({
  /** 案例生成的文档必须回到案例入口编辑。 */
  caseId: EntityIdSchema.nullable().optional(),
  id: EntityIdSchema,
  knowledgeBaseId: EntityIdSchema,
  title: z.string(),
  format: DocumentFormatSchema,
  sizeBytes: z.number().int().nonnegative(),
  status: DocumentStatusSchema,
  vectorCount: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
  version: z.number().int().nonnegative().optional(),
  activeRevisionId: EntityIdSchema.nullable().optional(),
  latestRevision: z
    .object({
      id: EntityIdSchema,
      version: z.number().int().positive(),
      title: z.string(),
      status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']),
      stage: z.string(),
      progress: z.number().min(0).max(100),
      error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean() }).nullable(),
    })
    .nullable()
    .optional(),
});
export const KnowledgeDocumentDetailSchema = KnowledgeDocumentSchema.extend({
  chunks: z.array(DocumentChunkSchema),
  previewText: z.string(),
});
export const KnowledgeDocumentListResponseSchema = z.object({
  items: z.array(KnowledgeDocumentSchema),
});
export const DocumentChunkListResponseSchema = z.object({ items: z.array(DocumentChunkSchema) });
export const DocumentUploadResponseSchema = z.object({
  document: KnowledgeDocumentSchema,
  jobId: EntityIdSchema,
});

/** 可引用文档块类型。 */
export type DocumentChunk = z.infer<typeof DocumentChunkSchema>;
/** 支持的知识文档格式类型。 */
export type DocumentFormat = z.infer<typeof DocumentFormatSchema>;
/** 文档处理状态类型。 */
export type DocumentStatus = z.infer<typeof DocumentStatusSchema>;
/** 上传文档后返回的任务与文档状态类型。 */
export type DocumentUploadResponse = z.infer<typeof DocumentUploadResponseSchema>;
/** 知识文档列表记录类型。 */
export type KnowledgeDocument = z.infer<typeof KnowledgeDocumentSchema>;
/** 带预览与文档块的知识文档详情类型。 */
export type KnowledgeDocumentDetail = z.infer<typeof KnowledgeDocumentDetailSchema>;
/** 可追溯原文位置类型。 */
export type SourceLocator = z.infer<typeof SourceLocatorSchema>;
