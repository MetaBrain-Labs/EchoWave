/**
 * 知识修改契约回归。
 *
 * 验证预期版本、替换输入和历史来源状态的网络边界。
 */
import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
  DocumentRenameRequestSchema,
  DocumentReplacementRequestSchema,
  CitationSourceResponseSchema,
} from '../dist/index.js';
it('requires an explicit valid version for document modifications', () => {
  assert.deepEqual(
    DocumentRenameRequestSchema.parse({ title: ' 新名称.md ', expectedVersion: 2 }),
    { title: '新名称.md', expectedVersion: 2 },
  );
  for (const input of [
    { title: 'a' },
    { title: ' ', expectedVersion: 1 },
    { title: 'a', expectedVersion: -1 },
    { title: 'a', expectedVersion: 1, tenantId: 'untrusted' },
  ])
    assert.equal(DocumentRenameRequestSchema.safeParse(input).success, false);
  assert.equal(DocumentReplacementRequestSchema.parse({ expectedVersion: '3' }).expectedVersion, 3);
  for (const expectedVersion of [undefined, '', null, false, '-1', '1.5']) {
    assert.equal(DocumentReplacementRequestSchema.safeParse({ expectedVersion }).success, false);
  }
  assert.equal(CitationSourceResponseSchema.safeParse({ status: 'deleted' }).success, true);
  assert.equal(CitationSourceResponseSchema.safeParse({ status: 'processing' }).success, false);
});
