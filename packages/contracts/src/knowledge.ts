/** Runtime contracts for knowledge-library ingestion, retrieval, and grounded answers. */
import { z } from 'zod';

export const EntityIdSchema = z.string().uuid();

export const KnowledgeBaseCreateRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1_000).default(''),
});

export const KnowledgeBaseUpdateRequestSchema = KnowledgeBaseCreateRequestSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: 'At least one field must be provided.' },
);

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

export const DocumentFormatSchema = z.enum(['markdown', 'word', 'spreadsheet']);

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

export const SourceLocatorSchema = z.discriminatedUnion('kind', [
  MarkdownLocatorSchema,
  WordLocatorSchema,
  SpreadsheetLocatorSchema,
]);

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

export const RagQueryRequestSchema = z.object({
  question: z.string().trim().min(1).max(2_000),
  conversationId: EntityIdSchema.optional(),
});

export const RagCitationSchema = z.object({
  number: z.number().int().positive(),
  documentId: EntityIdSchema,
  documentTitle: z.string(),
  chunkId: EntityIdSchema,
  locator: SourceLocatorSchema,
  excerpt: z.string(),
});

export const RagUsageSchema = z.object({
  embeddingTokens: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
});

export const RagQueryResponseSchema = z.object({
  conversationId: EntityIdSchema,
  answer: z.string(),
  grounded: z.boolean(),
  citations: z.array(RagCitationSchema),
  usage: RagUsageSchema,
});

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

export const ApiErrorResponseSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: ApiErrorCodeSchema,
    message: z.string(),
    retryable: z.boolean(),
  }),
});

export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;
export type DocumentChunk = z.infer<typeof DocumentChunkSchema>;
export type DocumentFormat = z.infer<typeof DocumentFormatSchema>;
export type DocumentStatus = z.infer<typeof DocumentStatusSchema>;
export type DocumentUploadResponse = z.infer<typeof DocumentUploadResponseSchema>;
export type KnowledgeBaseCreateRequest = z.infer<typeof KnowledgeBaseCreateRequestSchema>;
export type KnowledgeBaseDetail = z.infer<typeof KnowledgeBaseDetailSchema>;
export type KnowledgeBaseSummary = z.infer<typeof KnowledgeBaseSummarySchema>;
export type KnowledgeDocument = z.infer<typeof KnowledgeDocumentSchema>;
export type KnowledgeDocumentDetail = z.infer<typeof KnowledgeDocumentDetailSchema>;
export type RagQueryRequest = z.infer<typeof RagQueryRequestSchema>;
export type RagQueryResponse = z.infer<typeof RagQueryResponseSchema>;
export type SourceLocator = z.infer<typeof SourceLocatorSchema>;
