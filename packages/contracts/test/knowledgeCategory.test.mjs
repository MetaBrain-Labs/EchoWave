/** 知识类别契约回归：分类覆盖、并发版本和有界查询输入。 */
import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
  KnowledgeCategoryCreateSchema,
  KnowledgeCategoryUpdateSchema,
  DocumentClassificationUpdateSchema,
  RagQueryRequestSchema,
  KnowledgeBaseUpdateRequestSchema,
} from '../dist/index.js';
const id = '11111111-1111-4111-8111-111111111111';
it('validates category maintenance and bounded explicit query filters', () => {
  assert.equal(
    KnowledgeCategoryCreateSchema.safeParse({ name: '产品', description: '产品事实' }).success,
    true,
  );
  assert.equal(
    KnowledgeCategoryCreateSchema.safeParse({ name: '产品', description: '' }).success,
    false,
  );
  assert.equal(KnowledgeCategoryUpdateSchema.safeParse({ expectedVersion: 0 }).success, false);
  assert.equal(
    KnowledgeCategoryUpdateSchema.safeParse({ active: false, expectedVersion: 0 }).success,
    true,
  );
  assert.equal(
    RagQueryRequestSchema.safeParse({ question: '价格', categoryIds: [id] }).success,
    true,
  );
  assert.equal(
    RagQueryRequestSchema.safeParse({ question: '价格', categoryIds: [id, id] }).success,
    false,
  );
  assert.equal(
    RagQueryRequestSchema.safeParse({ question: '价格', categoryIds: [] }).success,
    false,
  );
  assert.equal(RagQueryRequestSchema.safeParse({ question: '价格' }).success, true);
  assert.equal(
    KnowledgeBaseUpdateRequestSchema.safeParse({ expectedCategoryVersion: 1 }).success,
    false,
  );
});
it('requires revision identity, document version and unique worksheet overrides', () => {
  const update = {
    revisionId: id,
    expectedVersion: 0,
    expectedDocumentVersion: 1,
    documentCategoryId: null,
    sheetAssignments: [],
  };
  assert.equal(DocumentClassificationUpdateSchema.parse(update).confirmSuggestion, false);
  assert.equal(
    DocumentClassificationUpdateSchema.safeParse({ ...update, expectedDocumentVersion: undefined })
      .success,
    false,
  );
  assert.equal(
    DocumentClassificationUpdateSchema.safeParse({
      ...update,
      sheetAssignments: [
        { sheet: '术语', categoryId: id },
        { sheet: '术语', categoryId: id },
      ],
    }).success,
    false,
  );
});
