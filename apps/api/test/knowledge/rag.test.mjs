import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createApp } from '../../dist/http/app.js';
import { OpenRouterEmbeddings } from '../../dist/knowledge/embeddings/openRouterEmbeddings.js';
import { DefaultKnowledgeService } from '../../dist/knowledge/service.js';

const kbId = '11111111-1111-4111-8111-111111111111';
const conversationId = '22222222-2222-4222-8222-222222222222';

describe('OpenRouter embeddings adapter', () => {
  it('adds the query instruction and enforces 1024 dimensions', async () => {
    let request;
    const embeddings = new OpenRouterEmbeddings({
      apiKey: 'secret',
      model: 'qwen/qwen3-embedding-8b',
      dimensions: 1024,
      fetchImplementation: async (_url, init) => {
        request = JSON.parse(init.body);
        return Response.json({
          data: [{ index: 0, embedding: Array.from({ length: 1024 }, () => 0.25) }],
          provider: 'test-provider',
          usage: { total_tokens: 7 },
        });
      },
    });
    const result = await embeddings.embedQueryWithUsage('产品机会是什么？');
    assert.equal(request.dimensions, 1024);
    assert.match(request.input[0], /^Given a user question/);
    assert.equal(result.vectors[0].length, 1024);
    assert.equal(result.tokens, 7);
    assert.equal(result.provider, 'test-provider');
  });

  it('splits document requests into batches of at most 64', async () => {
    const batchSizes = [];
    const embeddings = new OpenRouterEmbeddings({
      apiKey: 'secret', model: 'qwen/qwen3-embedding-8b', dimensions: 1024,
      fetchImplementation: async (_url, init) => {
        const body = JSON.parse(init.body);
        batchSizes.push(body.input.length);
        return Response.json({
          data: body.input.map((_value, index) => ({ index, embedding: Array(1024).fill(0) })),
          usage: { total_tokens: body.input.length },
        });
      },
    });
    const result = await embeddings.embedBatches(Array.from({ length: 65 }, (_, index) => `chunk-${index}`));
    assert.deepEqual(batchSizes, [64, 1]);
    assert.equal(result.vectors.length, 65);
  });
});

describe('upload validation', () => {
  const service = new DefaultKnowledgeService({}, {}, {}, {}, '.tmp/uploads-test', 'qwen/qwen3-embedding-8b');

  it('rejects legacy and macro-capable formats before persistence', async () => {
    await assert.rejects(
      service.uploadDocument(kbId, new File(['legacy'], 'legacy.doc', { type: 'application/msword' })),
      (error) => error.code === 'UNSUPPORTED_FORMAT',
    );
  });

  it('rejects an Office extension with a forged MIME/signature', async () => {
    await assert.rejects(
      service.uploadDocument(kbId, new File(['not-a-zip'], 'fake.docx', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })),
      (error) => error.code === 'INVALID_FILE',
    );
  });
});

describe('knowledge API contracts', () => {
  it('returns grounded query data through the injected service boundary', async () => {
    const service = {
      query: async () => ({
        conversationId,
        answer: '依据显示答案为 A。[1]',
        grounded: true,
        citations: [{
          number: 1, documentId: conversationId, documentTitle: '研究.md', chunkId: kbId,
          locator: { kind: 'markdown', headingPath: ['结论'], lineStart: 3, lineEnd: 4 }, excerpt: '答案为 A。',
        }],
        usage: { embeddingTokens: 4, inputTokens: 12, outputTokens: 8 },
      }),
    };
    const app = createApp({ corsOrigins: ['http://localhost:8081'] }, { knowledgeService: service });
    const response = await app.request(`/api/knowledge-bases/${kbId}/query`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: '答案是什么？' }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).citations[0].chunkId, kbId);
  });

  it('rejects invalid IDs before calling persistence', async () => {
    const app = createApp({ corsOrigins: [] }, { knowledgeService: { listDocuments: async () => ({ items: [] }) } });
    const response = await app.request('/api/knowledge-bases/not-a-uuid/documents');
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'BAD_REQUEST');
  });

  it('returns recent completed query history through the injected service boundary', async () => {
    const service = {
      listQueryHistory: async () => ({
        items: [{
          id: kbId,
          conversationId,
          question: '最近的问题',
          answer: '最近的回答',
          grounded: true,
          citationCount: 1,
          createdAt: '2026-08-20T12:00:00.000Z',
        }],
      }),
    };
    const app = createApp({ corsOrigins: [] }, { knowledgeService: service });
    const response = await app.request(`/api/knowledge-bases/${kbId}/query-history`);

    assert.equal(response.status, 200);
    assert.equal((await response.json()).items[0].question, '最近的问题');
  });
});
