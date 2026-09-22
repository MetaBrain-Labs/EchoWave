/**
 * 知识检索设置 HTTP 边界测试。
 *
 * 验证公开读取、管理员写入和严格乐观锁请求契约。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createApp } from '../../dist/http/app.js';
import { SettingsError } from '../../dist/settings/types.js';

const overview = {
  rerankEnabled: true,
  rerankerModel: 'qwen3.7-text-rerank',
  rerankerConfigured: true,
  revision: 3,
};

function settingsApp() {
  let updateCall;
  const service = {
    overview: async () => overview,
    update: async (authorization, input) => {
      if (authorization !== 'Bearer admin') {
        throw new SettingsError('UNAUTHORIZED', '管理口令无效。');
      }
      updateCall = { authorization, input };
      return { ...overview, rerankEnabled: input.rerankEnabled, revision: 4 };
    },
  };
  return {
    app: createApp(
      { corsOrigins: ['http://localhost:8081'] },
      { knowledgeRetrievalSettingsService: service },
    ),
    updateCall: () => updateCall,
  };
}

describe('knowledge retrieval settings routes', () => {
  it('exposes the non-secret tenant setting without administrator authentication', async () => {
    const { app } = settingsApp();
    const response = await app.request('/api/knowledge-retrieval-settings');

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), overview);
  });

  it('updates through the administrator boundary with an expected revision', async () => {
    const { app, updateCall } = settingsApp();
    const response = await app.request('/api/settings/knowledge-retrieval-settings', {
      method: 'PUT',
      headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({ rerankEnabled: false, expectedRevision: 3 }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(updateCall(), {
      authorization: 'Bearer admin',
      input: { rerankEnabled: false, expectedRevision: 3 },
    });
    assert.equal((await response.json()).rerankEnabled, false);
  });

  it('rejects unknown fields and unauthorized writes', async () => {
    const { app } = settingsApp();
    const invalid = await app.request('/api/settings/knowledge-retrieval-settings', {
      method: 'PUT',
      headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({ rerankEnabled: false, expectedRevision: 3, model: 'other' }),
    });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error.code, 'BAD_REQUEST');

    const unauthorized = await app.request('/api/settings/knowledge-retrieval-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rerankEnabled: false, expectedRevision: 3 }),
    });
    assert.equal(unauthorized.status, 401);
    assert.equal((await unauthorized.json()).error.code, 'UNAUTHORIZED');
  });
});
