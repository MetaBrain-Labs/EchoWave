/**
 * 知识文档修改传输回归。
 *
 * 验证版本输入、multipart 校验、结构化冲突和删除成功响应。
 */
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createApp } from '../../dist/http/app.js';
import { RagRepositoryError } from '../../dist/knowledge/persistence/errors.js';
const kb = '11111111-1111-4111-8111-111111111111';
const doc = '22222222-2222-4222-8222-222222222222';
const url = `/api/knowledge-bases/${kb}/documents/${doc}`;
it('validates revision writes and maps conflicts without altering DELETE semantics', async () => {
  const calls = [];
  const app = createApp(
    { corsOrigins: [] },
    {
      knowledgeService: {
        renameDocument: async (...args) => {
          calls.push(args);
          throw new RagRepositoryError('CONFLICT', 'refresh');
        },
        replaceDocument: async (...args) => {
          calls.push(args);
          return { accepted: true };
        },
        reindexDocument: async (...args) => {
          calls.push(args);
          return { accepted: true };
        },
        deleteDocument: async (...args) => {
          calls.push(args);
        },
        getCitationSource: async () => ({ status: 'deleted' }),
      },
    },
  );
  assert.equal(
    (
      await app.request(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'new' }),
      })
    ).status,
    400,
  );
  assert.equal(calls.length, 0);
  const conflict = await app.request(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'new', expectedVersion: 2 }),
  });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error.code, 'CONFLICT');
  const form = new FormData();
  form.append('file', new File(['body'], 'new.md', { type: 'text/markdown' }));
  form.append('expectedVersion', '3');
  assert.equal((await app.request(`${url}/revisions`, { method: 'POST', body: form })).status, 202);
  assert.deepEqual(calls[1].at(-1), { expectedVersion: 3 });
  assert.equal(
    (
      await app.request(`${url}/reindex`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedVersion: 3, force: true }),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await app.request(`${url}/reindex`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedVersion: 3 }),
      })
    ).status,
    202,
  );
  assert.deepEqual(calls[2], [kb, doc, { expectedVersion: 3 }]);
  assert.equal((await app.request(url, { method: 'DELETE' })).status, 204);
  assert.deepEqual(await (await app.request(`${url}/revisions/${doc}/source-status`)).json(), {
    status: 'deleted',
  });
});
