/**
 * 知识库网络契约。
 *
 * 定义知识库、知识文档、文档块、处理状态、可信回答、引用、用量和稳定错误的运行时结构。
 *
 * Responsibilities:
 * - 作为 API 生产端与移动端消费端的唯一 JSON 权威。
 * - 同步导出 Zod schema 与推断类型。
 *
 * Notes:
 * - 持久化内部字段和模型原始输出不得进入这些契约。
 */
import { z } from 'zod';

/** 所有知识库网络实体共享的 UUID 标识符 schema。 */
export const EntityIdSchema = z.string().uuid();

/** 创建知识库所需的用户输入 schema。 */
export const KnowledgeBaseCreateRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1_000).default(''),
});

/** 更新知识库的部分字段输入 schema，至少要求一个字段。 */
export const KnowledgeBaseUpdateRequestSchema = KnowledgeBaseCreateRequestSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: 'At least one field must be provided.' },
);

/** 知识库列表和详情共用的摘要 schema。 */
export const KnowledgeBaseSummarySchema = z.object({
  id: EntityIdSchema,
  name: z.string(),
  description: z.string(),
  documentCount: z.number().int().nonnegative(),
  linkedGroupCount: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
});

export const KnowledgeBaseListResponseSchema = z.object({
  items: z.array(KnowledgeBaseSummarySchema),
});

export const KnowledgeBaseDetailSchema = KnowledgeBaseSummarySchema;

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
  id: EntityIdSchema,
  knowledgeBaseId: EntityIdSchema,
  title: z.string(),
  format: DocumentFormatSchema,
  sizeBytes: z.number().int().nonnegative(),
  status: DocumentStatusSchema,
  vectorCount: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
});

export const KnowledgeDocumentDetailSchema = KnowledgeDocumentSchema.extend({
  chunks: z.array(DocumentChunkSchema),
  previewText: z.string(),
});

export const KnowledgeDocumentListResponseSchema = z.object({
  items: z.array(KnowledgeDocumentSchema),
});

export const DocumentChunkListResponseSchema = z.object({
  items: z.array(DocumentChunkSchema),
});

export const DocumentUploadResponseSchema = z.object({
  document: KnowledgeDocumentSchema,
  jobId: EntityIdSchema,
});

/** 用户提交知识库问题的最终 JSON 请求 schema。 */
export const RagQueryRequestSchema = z.object({
  question: z.string().trim().min(1).max(2_000),
  conversationId: EntityIdSchema.optional(),
});

/** 可信回答中一个已验证引用的 schema。 */
export const RagCitationSchema = z.object({
  number: z.number().int().positive(),
  documentId: EntityIdSchema,
  documentTitle: z.string(),
  chunkId: EntityIdSchema,
  locator: SourceLocatorSchema,
  excerpt: z.string(),
});

/** 一次可信回答产生的 embedding 与模型 token 用量 schema。 */
export const RagUsageSchema = z.object({
  embeddingTokens: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
});

/** 服务端完成引用校验和审计后返回的可信回答 schema。 */
export const RagQueryResponseSchema = z.object({
  conversationId: EntityIdSchema,
  answer: z.string(),
  grounded: z.boolean(),
  citations: z.array(RagCitationSchema),
  usage: RagUsageSchema,
});

/** 所有知识库 HTTP 错误允许使用的稳定错误码 schema。 */
export const ApiErrorCodeSchema = z.enum([
  'BAD_REQUEST',
  'CONFLICT',
  'DOCUMENT_TOO_LARGE',
  'DUPLICATE_DOCUMENT',
  'INTERNAL_ERROR',
  'INVALID_FILE',
  'MODEL_TIMEOUT',
  'MODEL_UNAVAILABLE',
  'NOT_FOUND',
  'UNSUPPORTED_FORMAT',
]);

/** 不泄露内部实现的统一 HTTP 错误响应 schema。 */
export const ApiErrorResponseSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: ApiErrorCodeSchema,
    message: z.string(),
    retryable: z.boolean(),
  }),
});

/** 稳定 HTTP 错误码类型。 */
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;
/** 统一 HTTP 错误响应类型。 */
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;
/** 可引用文档块类型。 */
export type DocumentChunk = z.infer<typeof DocumentChunkSchema>;
/** 支持的知识文档格式类型。 */
export type DocumentFormat = z.infer<typeof DocumentFormatSchema>;
/** 文档处理状态类型。 */
export type DocumentStatus = z.infer<typeof DocumentStatusSchema>;
/** 上传文档后返回的任务与文档状态类型。 */
export type DocumentUploadResponse = z.infer<typeof DocumentUploadResponseSchema>;
/** 创建知识库输入类型。 */
export type KnowledgeBaseCreateRequest = z.infer<typeof KnowledgeBaseCreateRequestSchema>;
/** 知识库详情类型。 */
export type KnowledgeBaseDetail = z.infer<typeof KnowledgeBaseDetailSchema>;
/** 知识库摘要类型。 */
export type KnowledgeBaseSummary = z.infer<typeof KnowledgeBaseSummarySchema>;
/** 知识文档列表记录类型。 */
export type KnowledgeDocument = z.infer<typeof KnowledgeDocumentSchema>;
/** 带预览与文档块的知识文档详情类型。 */
export type KnowledgeDocumentDetail = z.infer<typeof KnowledgeDocumentDetailSchema>;
/** 可信问答请求类型。 */
export type RagQueryRequest = z.infer<typeof RagQueryRequestSchema>;
/** 可信问答最终响应类型。 */
export type RagQueryResponse = z.infer<typeof RagQueryResponseSchema>;
/** 可追溯原文位置类型。 */
export type SourceLocator = z.infer<typeof SourceLocatorSchema>;
