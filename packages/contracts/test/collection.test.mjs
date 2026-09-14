/**
 * 收集契约回归。
 *
 * 锁定默认人工精选、扩展类别、输入边界和真实对话轮次约束。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CollectionRuleInputSchema,
  AnalysisCorrectionInputSchema,
  CaseContentSchema,
  ManualCollectionRequestSchema,
  CollectionHistoryRequestSchema,
} from '../dist/index.js';
const id = '11111111-1111-4111-8111-111111111111';
const category = { id: 'custom-stable', name: '异议处理' };
const turn = {
  segmentId: id,
  speakerLabel: 'A',
  role: 'unknown',
  text: '真实对话',
  startMs: 0,
  endMs: 1000,
};
test('rules default to review and accept stable custom categories and unrestricted filters', () => {
  const rule = CollectionRuleInputSchema.parse({
    name: '优选',
    category,
    knowledgeBaseId: id,
    filters: {},
  });
  assert.equal(rule.mode, 'review');
  assert.equal(rule.enabled, true);
  assert.deepEqual(rule.filters.sources, []);
  for (const mode of ['review', 'direct', 'manual'])
    assert.equal(CollectionRuleInputSchema.parse({ ...rule, mode }).mode, mode);
  assert.equal(
    CollectionRuleInputSchema.safeParse({ ...rule, knowledgeBaseId: '' }).success,
    false,
  );
  assert.equal(
    CollectionRuleInputSchema.safeParse({ ...rule, filters: { minimumConfidence: 101 } }).success,
    false,
  );
  assert.equal(CollectionRuleInputSchema.safeParse({ ...rule, unexpected: true }).success, false);
});
test('human corrections require explicit version and category-label consistency', () => {
  const correction = {
    expectedVersion: 0,
    category: 'custom',
    customLabel: '倾听',
    reason: '人工理由',
  };
  assert.equal(AnalysisCorrectionInputSchema.parse(correction).suggestedReply, '');
  assert.equal(
    AnalysisCorrectionInputSchema.safeParse({ ...correction, customLabel: null }).success,
    false,
  );
  assert.equal(
    AnalysisCorrectionInputSchema.safeParse({ ...correction, expectedVersion: -1 }).success,
    false,
  );
});
test('case turns must be unique and ordered, and manual capture has exactly one source', () => {
  const content = CaseContentSchema.parse({
    category,
    title: '案例',
    reason: '理由',
    turns: [turn],
  });
  assert.equal(content.suggestedReply, '');
  assert.equal(CaseContentSchema.safeParse({ ...content, turns: [turn, turn] }).success, false);
  assert.equal(
    CaseContentSchema.safeParse({ ...content, turns: [{ ...turn, endMs: 0 }] }).success,
    false,
  );
  const input = { jobId: id, knowledgeBaseId: id, category };
  assert.equal(ManualCollectionRequestSchema.safeParse(input).success, false);
  assert.equal(
    ManualCollectionRequestSchema.safeParse({ ...input, tagId: id, segmentIds: [id] }).success,
    false,
  );
  assert.equal(
    ManualCollectionRequestSchema.safeParse({ ...input, segmentIds: [id] }).success,
    true,
  );
  assert.equal(
    CollectionHistoryRequestSchema.safeParse({
      ruleId: id,
      from: '2026-09-14T00:00:00Z',
      to: '2026-09-13T00:00:00Z',
    }).success,
    false,
  );
});
