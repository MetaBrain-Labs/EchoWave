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
  EntityIdSchema,
  type ApiErrorCode,
  type ApiErrorResponse,
} from './common.ts';
export {
  DocumentChunkListResponseSchema,
  DocumentChunkSchema,
  DocumentFormatSchema,
  DocumentStatusSchema,
  DocumentUploadResponseSchema,
  KnowledgeDocumentDetailSchema,
  KnowledgeDocumentListResponseSchema,
  KnowledgeDocumentSchema,
  MarkdownLocatorSchema,
  SourceLocatorSchema,
  SpreadsheetLocatorSchema,
  WordLocatorSchema,
  type DocumentChunk,
  type DocumentFormat,
  type DocumentStatus,
  type DocumentUploadResponse,
  type KnowledgeDocument,
  type KnowledgeDocumentDetail,
  type SourceLocator,
} from './document.ts';
export {
  KnowledgeBaseCreateRequestSchema,
  KnowledgeBaseDetailSchema,
  KnowledgeBaseListResponseSchema,
  KnowledgeBaseSummarySchema,
  KnowledgeBaseUpdateRequestSchema,
  type KnowledgeBaseCreateRequest,
  type KnowledgeBaseDetail,
  type KnowledgeBaseSummary,
} from './knowledgeBase.ts';
export {
  RagCitationSchema,
  RagHistoryItemSchema,
  RagHistoryResponseSchema,
  RagQueryRequestSchema,
  RagQueryResponseSchema,
  RagUsageSchema,
  type RagHistoryItem,
  type RagHistoryResponse,
  type RagQueryRequest,
  type RagQueryResponse,
} from './rag.ts';
