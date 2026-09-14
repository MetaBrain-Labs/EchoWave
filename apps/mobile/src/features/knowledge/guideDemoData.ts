/**
 * 知识库引导演示数据。
 *
 * 为无数据或主动播放引导时提供一组完全脱敏的本地只读对象，保持详情、文档、文本块和问答页面的真实结构。
 *
 * Responsibilities:
 * - 提供知识库详情、文档详情和问答引用的演示对象。
 * - 保证引导不会创建、上传、解析或查询服务器数据。
 *
 * Notes:
 * - 所有 ID、模型名称和内容均为演示值，不代表真实业务配置。
 */
import type {
  KnowledgeBaseDetail,
  KnowledgeDocumentDetail,
  RagQueryResponse,
} from '@echowave/contracts';

export const GUIDE_DEMO_KNOWLEDGE_ID = '00000000-0000-4000-8000-000000000001';
export const GUIDE_DEMO_DOCUMENT_ID = '00000000-0000-4000-8000-000000000002';
export const GUIDE_DEMO_BLOCK_IDS = [
  '00000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000004',
] as const;

export const guideDemoKnowledge: KnowledgeBaseDetail = {
  id: GUIDE_DEMO_KNOWLEDGE_ID,
  name: '引导演示知识库',
  description: '仅用于了解知识库详情、文本块和问答引用流程。',
  documentCount: 1,
  linkedGroupCount: 1,
  updatedAt: '2026-09-01T10:00:00.000Z',
  settings: {
    storageLocation: 'local',
    indexingMode: 'rag',
    embeddingModel: 'demo-embedding-model',
    rerankerModel: null,
    parsingMode: 'automatic',
  },
  totalSizeBytes: 4096,
  parsedDocumentCount: 1,
  pendingDocumentCount: 0,
  lastUploadedAt: '2026-09-01T09:30:00.000Z',
};

export const guideDemoDocument: KnowledgeDocumentDetail = {
  id: GUIDE_DEMO_DOCUMENT_ID,
  knowledgeBaseId: GUIDE_DEMO_KNOWLEDGE_ID,
  title: '客户访谈复盘规范（演示）',
  format: 'markdown',
  sizeBytes: 4096,
  status: { kind: 'ready', parsedAt: '2026-09-01T10:00:00.000Z' },
  vectorCount: GUIDE_DEMO_BLOCK_IDS.length,
  updatedAt: '2026-09-01T10:00:00.000Z',
  previewText: '复盘目标\n引用原则',
  chunks: [
    {
      id: GUIDE_DEMO_BLOCK_IDS[0],
      index: 1,
      title: '复盘目标',
      content: '先确认客户需求和下一步行动，再评价沟通表现。',
      charCount: 24,
      vectorId: GUIDE_DEMO_BLOCK_IDS[0],
      locator: { kind: 'markdown', headingPath: ['复盘目标'], lineStart: 3, lineEnd: 5 },
      sourceExcerpt: '先确认客户需求和下一步行动，再评价沟通表现。',
    },
    {
      id: GUIDE_DEMO_BLOCK_IDS[1],
      index: 2,
      title: '引用原则',
      content: '回答需要同时展示结论和可回到原文的证据。',
      charCount: 22,
      vectorId: GUIDE_DEMO_BLOCK_IDS[1],
      locator: { kind: 'markdown', headingPath: ['引用原则'], lineStart: 8, lineEnd: 10 },
      sourceExcerpt: '回答需要同时展示结论和可回到原文的证据。',
    },
  ],
};

export const guideDemoQueryResponse: RagQueryResponse = {
  conversationId: '00000000-0000-4000-8000-000000000005',
  answer: '演示资料建议先确认客户需求和下一步行动，再评价沟通表现，并保留可以回到原文的证据。',
  grounded: true,
  citations: [
    {
      number: 1,
      documentId: GUIDE_DEMO_DOCUMENT_ID,
      documentTitle: guideDemoDocument.title,
      chunkId: GUIDE_DEMO_BLOCK_IDS[0],
      locator: guideDemoDocument.chunks[0].locator,
      excerpt: guideDemoDocument.chunks[0].sourceExcerpt,
    },
    {
      number: 2,
      documentId: GUIDE_DEMO_DOCUMENT_ID,
      documentTitle: guideDemoDocument.title,
      chunkId: GUIDE_DEMO_BLOCK_IDS[1],
      locator: guideDemoDocument.chunks[1].locator,
      excerpt: guideDemoDocument.chunks[1].sourceExcerpt,
    },
  ],
  usage: { embeddingTokens: 0, inputTokens: 0, outputTokens: 0 },
};
