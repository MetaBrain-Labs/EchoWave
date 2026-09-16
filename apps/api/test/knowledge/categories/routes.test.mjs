/** 类别 HTTP 边界回归：共享契约校验、版本冲突和标准基础响应。 */
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createApp } from '../../../dist/http/app.js';
import { RagRepositoryError } from '../../../dist/knowledge/persistence/errors.js';
const id = '11111111-1111-4111-8111-111111111111';
it('validates category writes before service calls and returns structured conflicts', async () => {
  let writes = 0;
  const app = createApp(
    { corsOrigins: [] },
    {
      knowledgeService: {
        categories: {
          list: async () => ({ items: [] }),
          create: async (input) => {
            writes++;
            return { id, ...input, key: null, active: true, version: 0 };
          },
          update: async () => {
            throw new RagRepositoryError('CONFLICT', '类别版本已变化。');
          },
          available: async () => ({ items: [] }),
        },
      },
    },
  );
  const invalid = await app.request('/api/knowledge-categories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '产品' }),
  });
  assert.equal(invalid.status, 400);
  assert.equal(writes, 0);
  const created = await app.request('/api/knowledge-categories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '产品', description: '事实' }),
  });
  assert.equal(created.status, 201);
  assert.equal(writes, 1);
  const conflict = await app.request(`/api/knowledge-categories/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active: false, expectedVersion: 0 }),
  });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error.code, 'CONFLICT');
  assert.equal((await app.request(`/api/knowledge-bases/${id}/categories`)).status, 200);
  const hello = await app.request('/api/hello');
  assert.deepEqual(await hello.json(), {
    ok: true,
    service: 'echowave-api',
    message: 'HelloWorld',
  });
  const missing = await app.request('/api/unknown');
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error.code, 'NOT_FOUND');
});
