/**
 * Qwen3.7 文本重排适配器测试。
 *
 * 验证固定端点、请求体、用量、有限重试与非法响应拒绝。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DashScopeReranker,
  RerankProviderError,
} from '../../../dist/knowledge/retrieval/dashScopeReranker.js';

describe('DashScopeReranker', () => {
  it('uses the Workspace endpoint and restores scores to document indexes', async () => {
    let request;
    const reranker = new DashScopeReranker({
      apiKey: 'test-key',
      baseUrl: 'https://workspace.example.com/api/v1',
      fetchImplementation: async (url, init) => {
        request = { url, body: JSON.parse(init.body), authorization: init.headers.Authorization };
        return new Response(
          JSON.stringify({
            output: {
              results: [
                { index: 1, relevance_score: 0.9 },
                { index: 0, relevance_score: 0.4 },
              ],
            },
            usage: { total_tokens: 17 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      },
    });

    const result = await reranker.rerank('问题', ['文档一', '文档二']);

    assert.equal(
      request.url,
      'https://workspace.example.com/api/v1/services/rerank/text-rerank/text-rerank',
    );
    assert.equal(request.authorization, 'Bearer test-key');
    assert.equal(request.body.model, 'qwen3.7-text-rerank');
    assert.equal(request.body.parameters.top_n, 2);
    assert.equal(request.body.parameters.return_documents, undefined);
    assert.deepEqual(result.scores, [0.4, 0.9]);
    assert.equal(result.tokens, 17);
  });

  it('retries one 429 and rejects duplicate indexes without leaking payloads', async () => {
    let calls = 0;
    const retrying = new DashScopeReranker({
      apiKey: 'test-key',
      baseUrl: 'https://workspace.example.com/api/v1',
      fetchImplementation: async () => {
        calls += 1;
        if (calls === 1) return new Response('{}', { status: 429 });
        return new Response(
          JSON.stringify({
            output: { results: [{ index: 0, relevance_score: 0.7 }] },
            usage: { total_tokens: 3 },
          }),
          { status: 200 },
        );
      },
    });
    assert.equal((await retrying.rerank('q', ['d'])).attempts, 2);
    assert.equal(calls, 2);

    const invalid = new DashScopeReranker({
      apiKey: 'test-key',
      baseUrl: 'https://workspace.example.com/api/v1',
      fetchImplementation: async () =>
        new Response(
          JSON.stringify({
            output: {
              results: [
                { index: 0, relevance_score: 0.7 },
                { index: 0, relevance_score: 0.6 },
              ],
            },
            usage: { total_tokens: 3 },
          }),
          { status: 200 },
        ),
    });
    await assert.rejects(
      invalid.rerank('secret query', ['secret one', 'secret two']),
      (error) =>
        error instanceof RerankProviderError &&
        error.code === 'INVALID_RESPONSE' &&
        !error.message.includes('secret'),
    );
  });

  it('retries one server failure and classifies cancellation and malformed JSON safely', async () => {
    let calls = 0;
    const serverFailure = new DashScopeReranker({
      apiKey: 'test-key',
      baseUrl: 'https://workspace.example.com/api/v1',
      fetchImplementation: async () => {
        calls += 1;
        if (calls === 1) return new Response('{}', { status: 503 });
        return new Response(
          JSON.stringify({
            output: { results: [{ index: 0, relevance_score: 0.5 }] },
            usage: { total_tokens: 2 },
          }),
          { status: 200 },
        );
      },
    });
    await serverFailure.rerank('q', ['d']);
    assert.equal(calls, 2);

    const cancelled = new AbortController();
    cancelled.abort();
    await assert.rejects(
      serverFailure.rerank('q', ['d'], cancelled.signal),
      (error) => error instanceof RerankProviderError && error.code === 'MODEL_TIMEOUT',
    );

    const invalidJson = new DashScopeReranker({
      apiKey: 'test-key',
      baseUrl: 'https://workspace.example.com/api/v1',
      fetchImplementation: async () => new Response('{', { status: 200 }),
    });
    await assert.rejects(
      invalidJson.rerank('q', ['d']),
      (error) => error instanceof RerankProviderError && error.code === 'INVALID_RESPONSE',
    );
  });
});
