import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  KnowledgeBaseCreateRequestSchema,
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
});
