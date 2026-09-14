/**
 * 收集 HTTP 信任边界回归。
 *
 * 验证默认规则、结构化版本冲突、批量部分成功和媒体缺失。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../../dist/http/app.js';
import { RagRepositoryError } from '../../dist/knowledge/persistence/errors.js';
const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
let saved;
const service = {
  repository: {
    saveRule: async (_group, input) => {
      saved = input;
      return input;
    },
  },
  action: async (caseId) => {
    if (caseId === other) throw new RagRepositoryError('CONFLICT', '版本已变化。');
    return {};
  },
  playback: async () => {
    throw new RagRepositoryError('NOT_FOUND', '案例音频尚不可用。');
  },
};
const app = createApp({ corsOrigins: [] }, { collectionService: service });
const post = (path, body) =>
  app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
test('creation applies default review and rejects invalid target', async () => {
  const input = {
    name: '优点',
    category: { id: 'strength', name: '优点' },
    knowledgeBaseId: id,
    filters: {},
  };
  assert.equal((await post(`/api/groups/${id}/collection-rules`, input)).status, 201);
  assert.equal(saved.mode, 'review');
  assert.equal(
    (await post(`/api/groups/${id}/collection-rules`, { ...input, knowledgeBaseId: '' })).status,
    400,
  );
});
test('version conflicts remain structured and bulk processing reports each result', async () => {
  const response = await post(`/api/knowledge-cases/${other}/actions`, {
    expectedVersion: 1,
    action: 'publish',
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, 'CONFLICT');
  const bulk = await post('/api/knowledge-cases/batch-actions', {
    items: [id, other].map((id) => ({ id, expectedVersion: 1, action: 'publish' })),
  });
  assert.deepEqual(
    (await bulk.json()).items.map((v) => v.success),
    [true, false],
  );
});
test('unavailable media has no playable response and existing public routes are preserved', async () => {
  assert.equal(
    (await app.request(`/api/knowledge-cases/${id}/media/${other}?version=1`)).status,
    404,
  );
  assert.equal((await app.request('/api/hello')).status, 200);
  assert.equal((await app.request('/absent')).status, 404);
});
