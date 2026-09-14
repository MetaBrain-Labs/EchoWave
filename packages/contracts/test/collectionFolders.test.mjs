/** 收集目录信任边界回归，不访问业务存储。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CollectionFolderSchema,
  KnowledgeDirectorySchema,
  OrganizeCollectionCasesSchema,
  FrozenCollectionRuleSchema,
} from '../dist/index.js';
const id = '11111111-1111-4111-8111-111111111111';
const folder = {
  id,
  knowledgeBaseId: id,
  kind: 'legacy',
  ruleId: null,
  groupId: null,
  name: '历史收集',
  caseCount: 2,
  updatedAt: '2026-09-14T00:00:00Z',
};
test('directory accepts ordinary documents and rule folders without duplicating document state', () => {
  assert.ok(
    KnowledgeDirectorySchema.safeParse({
      items: [
        { kind: 'folder', folder, updatedAt: folder.updatedAt },
        { kind: 'document', documentId: id, updatedAt: folder.updatedAt },
      ],
    }).success,
  );
  assert.equal(CollectionFolderSchema.safeParse({ ...folder, caseCount: -1 }).success, false);
  assert.equal(
    KnowledgeDirectorySchema.safeParse({
      items: [{ kind: 'folder', folder: { ...folder, id: 'bad' }, updatedAt: folder.updatedAt }],
    }).success,
    false,
  );
});
test('history organizing requires unique case identities, positive versions and bounded batches', () => {
  const item = { id, expectedVersion: 1 };
  assert.ok(OrganizeCollectionCasesSchema.safeParse({ ruleId: id, items: [item] }).success);
  for (const input of [
    { ruleId: id, items: [] },
    { ruleId: id, items: [item, item] },
    { ruleId: id, items: [{ ...item, expectedVersion: 0 }] },
    { ruleId: id, items: [item], knowledgeBaseId: id },
  ])
    assert.equal(OrganizeCollectionCasesSchema.safeParse(input).success, false);
});
test('frozen rules reject missing identities and invalid input rather than guessing by name', () => {
  assert.equal(
    FrozenCollectionRuleSchema.safeParse({ id, version: 1, input: { name: 'same name' } }).success,
    false,
  );
  assert.equal(FrozenCollectionRuleSchema.safeParse({ version: 1, input: {} }).success, false);
});
