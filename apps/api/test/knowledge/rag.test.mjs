import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createApp } from '../../dist/http/app.js';
import { DashScopeEmbeddings } from '../../dist/knowledge/embeddings/dashScopeEmbeddings.js';
import { DefaultKnowledgeService } from '../../dist/knowledge/service.js';

const kbId = '11111111-1111-4111-8111-111111111111';

function createEmbeddings(fetchImplementation) {
  return new DashScopeEmbeddings({
    apiKey: 'secret',
    baseUrl: 'https://workspace.example.com/api/v1',
    model: 'qwen3.7-text-embedding',
    dimensions: 1024,
    fetchImplementation,
  });
}

describe('DashScope embeddings adapter', () => {
  it('uses the native query contract and restores response order', async () => {
    let requestUrl;
    let request;
    const embeddings = createEmbeddings(async (url, init) => {
      requestUrl = url;
      request = JSON.parse(init.body);
      return Response.json({
        output: {
          embeddings: [{ text_index: 0, embedding: Array(1024).fill(0.25) }],
        },
        usage: { total_tokens: 7 },
      });
    });
    const result = await embeddings.embedQueryWithUsage('问题一');
    assert.equal(
      requestUrl,
      'https://workspace.example.com/api/v1/services/embeddings/text-embedding/text-embedding',
    );
    assert.deepEqual(request.input.texts, ['问题一']);
    assert.equal(request.parameters.text_type, 'query');
    assert.match(request.parameters.instruct, /^Given a user question/);
    assert.equal(request.parameters.dimension, 1024);
    assert.equal(request.parameters.output_type, 'dense');
    assert.equal(result.vectors[0][0], 0.25);
    assert.equal(result.tokens, 7);
    assert.equal(result.provider, 'dashscope');
    assert.deepEqual(result.estimatedCost, { amount: 0.0000035, currency: 'CNY' });
  });

  it('uses document text type and batches at most 20 texts', async () => {
    const batchSizes = [];
    const embeddings = createEmbeddings(async (_url, init) => {
      const body = JSON.parse(init.body);
      batchSizes.push(body.input.texts.length);
      assert.equal(body.parameters.text_type, 'document');
      assert.equal(body.parameters.instruct, undefined);
      return Response.json({
        output: {
          embeddings: body.input.texts.map((_value, index) => ({
            text_index: index,
            embedding: Array(1024).fill(0),
          })),
        },
        usage: { total_tokens: body.input.texts.length },
      });
    });
    const result = await embeddings.embedBatches(
      Array.from({ length: 41 }, (_, index) => `chunk-${index}`),
    );
    assert.deepEqual(batchSizes, [20, 20, 1]);
    assert.equal(result.vectors.length, 41);
  });

  it('retries 429 but does not retry other 4xx responses', async () => {
    let throttledCalls = 0;
    const throttled = createEmbeddings(async () => {
      throttledCalls += 1;
      if (throttledCalls === 1) return new Response('{}', { status: 429 });
      return Response.json({
        output: { embeddings: [{ text_index: 0, embedding: Array(1024).fill(0) }] },
        usage: { total_tokens: 1 },
      });
    });
    await throttled.embedQueryWithUsage('问题');
    assert.equal(throttledCalls, 2);

    let badRequestCalls = 0;
    const badRequest = createEmbeddings(async () => {
      badRequestCalls += 1;
      return new Response('{}', { status: 400 });
    });
    await assert.rejects(badRequest.embedQueryWithUsage('问题'));
    assert.equal(badRequestCalls, 1);
  });

  it('stops retries when the parent signal aborts', async () => {
    const controller = new AbortController();
    let calls = 0;
    const embeddings = createEmbeddings(async (_url, init) => {
      calls += 1;
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      });
    });
    const request = embeddings.embedQueryWithUsage('产品机会是什么？', controller.signal);
    controller.abort(new DOMException('answer timed out', 'TimeoutError'));
    await assert.rejects(request, (error) => error.code === 'MODEL_TIMEOUT');
    assert.equal(calls, 1);
  });
});

describe('upload validation', () => {
  const service = new DefaultKnowledgeService(
    {},
    {},
    {},
    {},
    '.tmp/uploads-test',
    'qwen3.7-text-embedding',
  );

  it('rejects legacy formats before persistence', async () => {
    await assert.rejects(
      service.uploadDocument(
        kbId,
        new File(['legacy'], 'legacy.doc', { type: 'application/msword' }),
      ),
      (error) => error.code === 'UNSUPPORTED_FORMAT',
    );
  });
});

describe('knowledge API contracts', () => {
  it('rejects invalid IDs before calling persistence', async () => {
    const app = createApp(
      { corsOrigins: [] },
      { knowledgeService: { listDocuments: async () => ({ items: [] }) } },
    );
    const response = await app.request('/api/knowledge-bases/not-a-uuid/documents');
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'BAD_REQUEST');
  });
});
