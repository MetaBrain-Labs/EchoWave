/**
 * 知识库测试固件。
 *
 * 提供符合共享运行时契约的稳定知识库、文档与文档块数据，供多个页面测试复用。
 *
 * Responsibilities:
 * - 集中构造可追溯的测试记录。
 *
 * Notes:
 * - 固件 ID 与时间固定，禁止依赖真实服务。
 */
import type { KnowledgeBaseDetail, KnowledgeBaseSummary, KnowledgeDocumentDetail } from '@echowave/contracts';

export const knowledge: KnowledgeBaseDetail = {
  id: '11111111-1111-4111-8111-111111111111', name: '产品研究知识库', description: '真实 API 知识库',
  documentCount: 1, linkedGroupCount: 0, updatedAt: '2026-08-19T10:00:00.000Z',
  settings: {
    storageLocation: 'local', indexingMode: 'rag', embeddingModel: 'qwen/qwen3-embedding-8b',
    rerankerModel: null, parsingMode: 'automatic',
  },
  totalSizeBytes: 1024, parsedDocumentCount: 1, pendingDocumentCount: 0,
  lastUploadedAt: '2026-08-19T10:00:00.000Z',
};
export const knowledgeSummary: KnowledgeBaseSummary = {
  id: knowledge.id, name: knowledge.name, description: knowledge.description,
  documentCount: knowledge.documentCount, linkedGroupCount: knowledge.linkedGroupCount,
  updatedAt: knowledge.updatedAt,
};
export const document: KnowledgeDocumentDetail = {
  id: '22222222-2222-4222-8222-222222222222', knowledgeBaseId: knowledge.id, title: '用户研究执行计划',
  format: 'markdown', sizeBytes: 1024, status: { kind: 'ready', parsedAt: '2026-08-19T10:00:00.000Z' },
  vectorCount: 2, updatedAt: '2026-08-19T10:00:00.000Z', previewText: '研究背景\n核心需求',
  chunks: [
    { id: '33333333-3333-4333-8333-333333333333', index: 1, title: '研究背景', content: '团队正在梳理音频访谈工作流。', charCount: 16, vectorId: '33333333-3333-4333-8333-333333333333', locator: { kind: 'markdown', headingPath: ['研究背景'], lineStart: 3, lineEnd: 5 }, sourceExcerpt: '团队正在梳理音频访谈工作流。' },
    { id: '44444444-4444-4444-8444-444444444444', index: 2, title: '核心需求', content: '回答需要关联原始证据。', charCount: 12, vectorId: '44444444-4444-4444-8444-444444444444', locator: { kind: 'markdown', headingPath: ['核心需求'], lineStart: 8, lineEnd: 10 }, sourceExcerpt: '回答需要关联原始证据。' },
  ],
};
