/**
 * 共享契约包导出入口。
 *
 * 集中公开 API 与移动端共同使用的 Zod schema 和推断类型，避免消费者绕过权威契约路径。
 *
 * Responsibilities:
 * - 导出 HelloWorld 与知识库网络契约。
 *
 * Notes:
 * - 不包含传输实现或应用业务逻辑。
 */
export { HelloResponseSchema, type HelloResponse } from './hello.ts';
export {
  ApiErrorCodeSchema,
  ApiErrorResponseSchema,
  DocumentChunkListResponseSchema,
  DocumentChunkSchema,
  DocumentFormatSchema,
  DocumentStatusSchema,
  DocumentUploadResponseSchema,
  EntityIdSchema,
  KnowledgeBaseCreateRequestSchema,
  KnowledgeBaseDetailSchema,
  KnowledgeBaseListResponseSchema,
  KnowledgeBaseSummarySchema,
  KnowledgeBaseUpdateRequestSchema,
  KnowledgeDocumentDetailSchema,
  KnowledgeDocumentListResponseSchema,
  KnowledgeDocumentSchema,
  MarkdownLocatorSchema,
  RagCitationSchema,
  RagQueryRequestSchema,
  RagQueryResponseSchema,
  RagUsageSchema,
  SourceLocatorSchema,
  SpreadsheetLocatorSchema,
  WordLocatorSchema,
  type ApiErrorCode,
  type ApiErrorResponse,
  type DocumentChunk,
  type DocumentFormat,
  type DocumentStatus,
  type DocumentUploadResponse,
  type KnowledgeBaseCreateRequest,
  type KnowledgeBaseDetail,
  type KnowledgeBaseSummary,
  type KnowledgeDocument,
  type KnowledgeDocumentDetail,
  type RagQueryRequest,
  type RagQueryResponse,
  type SourceLocator,
} from './knowledge.ts';
