import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  KnowledgeBaseCreateRequestSchema,
  KnowledgeBaseDetailSchema,
  KnowledgeBaseGroupLinkRequestSchema,
  RagHistoryResponseSchema,
  RagQueryResponseSchema,
  SourceLocatorSchema,
} from '../../dist/index.js';

describe('knowledge contracts', () => {
  it('validates each source locator without inventing page numbers', () => {
    assert.equal(
      SourceLocatorSchema.parse({
        kind: 'spreadsheet',
        sheet: '销售明细',
        rowStart: 2,
        rowEnd: 8,
      }).sheet,
      '销售明细',
    );
    assert.throws(() =>
      SourceLocatorSchema.parse({ kind: 'word', page: 1, line: 4 }),
    );
  });

  it('rejects empty knowledge-base names', () => {
    assert.throws(() => KnowledgeBaseCreateRequestSchema.parse({ name: '  ' }));
  });

  it('validates knowledge-base overview settings and nullable upload facts', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    const detail = KnowledgeBaseDetailSchema.parse({
      id,
      name: '产品知识库',
      description: '',
      documentCount: 0,
      linkedGroupCount: 0,
      updatedAt: '2026-08-21T10:00:00.000Z',
      settings: {
        storageLocation: 'local',
        indexingMode: 'rag',
        embeddingModel: 'qwen/qwen3-embedding-8b',
        rerankerModel: null,
        parsingMode: 'automatic',
      },
      totalSizeBytes: 0,
      parsedDocumentCount: 0,
      pendingDocumentCount: 0,
      lastUploadedAt: null,
    });

    assert.equal(detail.settings.rerankerModel, null);
    assert.throws(() => KnowledgeBaseDetailSchema.parse({
      ...detail,
      settings: { ...detail.settings, indexingMode: 'hybrid' },
    }));
  });

  it('requires a bounded unique list of group IDs for knowledge links', () => {
    const first = '00000000-0000-4000-8000-000000000001';
    const second = '00000000-0000-4000-8000-000000000002';
    assert.deepEqual(KnowledgeBaseGroupLinkRequestSchema.parse({ groupIds: [first, second] }), {
      groupIds: [first, second],
    });
    assert.throws(() => KnowledgeBaseGroupLinkRequestSchema.parse({ groupIds: [] }));
    assert.throws(() => KnowledgeBaseGroupLinkRequestSchema.parse({ groupIds: [first, first] }));
    assert.throws(() => KnowledgeBaseGroupLinkRequestSchema.parse({ groupIds: ['invalid'] }));
    assert.throws(() => KnowledgeBaseGroupLinkRequestSchema.parse({
      groupIds: Array.from({ length: 101 }, (_, index) =>
        `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`),
    }));
  });

  it('validates grounded answers with typed citations', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    const result = RagQueryResponseSchema.parse({
      conversationId: id,
      answer: '结论来自资料。[1]',
      grounded: true,
      citations: [
        {
          number: 1,
          documentId: id,
          documentTitle: '资料.md',
          chunkId: id,
          locator: {
            kind: 'markdown',
            headingPath: ['背景'],
            lineStart: 3,
            lineEnd: 8,
          },
          excerpt: '资料内容',
        },
      ],
      usage: { embeddingTokens: 8, inputTokens: 50, outputTokens: 12 },
    });

    assert.equal(result.citations.length, 1);
  });

  it('validates at most six read-only completed history items', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    const history = RagHistoryResponseSchema.parse({
      items: [{
        id,
        conversationId: id,
        question: '结论是什么？',
        answer: '结论来自资料。',
        grounded: true,
        citationCount: 2,
        createdAt: '2026-08-20T12:00:00.000Z',
      }],
    });

    assert.equal(history.items[0].citationCount, 2);
    assert.throws(() => RagHistoryResponseSchema.parse({
      items: [{ ...history.items[0], citationCount: -1 }],
    }));
    assert.throws(() => RagHistoryResponseSchema.parse({
      items: Array.from({ length: 7 }, () => history.items[0]),
    }));
  });
});
