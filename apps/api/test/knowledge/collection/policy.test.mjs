/**
 * 案例证据策略回归。
 *
 * 覆盖筛选组合、未知角色、来源去重和建议话术的原声边界。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CollectionRuleInputSchema } from '@echowave/contracts';
import {
  selectEvidenceTurns,
  matchesCollectionRule,
  collectionDedupeKey,
  validateCaseTurns,
  caseMarkdown,
  contentForSource,
} from '../../../dist/knowledge/collection/policy.js';
const id = '11111111-1111-4111-8111-111111111111';
const turns = ['sales', 'customer', 'sales', 'unknown', 'sales'].map((role, i) => ({
  segmentId: `11111111-1111-4111-8111-11111111111${i}`,
  speakerLabel: 'Speaker',
  role,
  text: i === 1 ? 'Price objection' : 'Original words',
  startMs: i * 1000,
  endMs: (i + 1) * 1000,
}));
const source = {
  jobId: id,
  groupId: id,
  audioFileId: id,
  dataSourceId: id,
  analysisRevisionId: id,
  confirmationVersion: 1,
  tagId: id,
  correctionId: null,
  category: 'strength',
  customLabel: '倾听',
  title: 'Response',
  reason: 'Rationale',
  confidence: 90,
  suggestedReply: 'Suggested only',
  segmentIds: [turns[2].segmentId, turns[4].segmentId],
  availableTurns: turns,
};
const rule = CollectionRuleInputSchema.parse({
  name: 'Collect',
  category: { id: 'strength', name: '优点' },
  knowledgeBaseId: id,
  filters: {
    sources: ['strength'],
    customLabels: ['其他', '倾听'],
    keywords: ['absent', 'price'],
    dataSourceIds: [id],
    minimumConfidence: 80,
  },
});
test('evidence retains intervening dialogue and preceding customer, without inventing roles', () => {
  assert.deepEqual(selectEvidenceTurns(turns, source.segmentIds), turns.slice(1));
  assert.equal(selectEvidenceTurns(turns, [turns[4].segmentId])[0].role, 'sales');
  assert.throws(() => selectEvidenceTurns(turns, ['missing']));
});
test('different filters intersect, options union, absent filters do not restrict', () => {
  assert.equal(matchesCollectionRule(rule, source), true);
  assert.equal(matchesCollectionRule(rule, { ...source, confidence: 79 }), false);
  assert.equal(matchesCollectionRule(rule, { ...source, category: 'risk' }), false);
  assert.equal(matchesCollectionRule(rule, { ...source, customLabel: null }), false);
  assert.equal(
    matchesCollectionRule(
      { ...rule, filters: { ...rule.filters, dataSourceIds: ['different'] } },
      source,
    ),
    false,
  );
  assert.equal(
    matchesCollectionRule(
      {
        ...rule,
        filters: {
          sources: [],
          customLabels: [],
          dataSourceIds: [],
          minimumConfidence: null,
          keywords: [],
        },
      },
      source,
    ),
    true,
  );
  assert.equal(
    matchesCollectionRule(
      { ...rule, filters: { ...rule.filters, sources: ['correction'] } },
      { ...source, category: 'correction', correctionId: id, confidence: 0 },
    ),
    true,
  );
});
test('dedupe distinguishes source versions and categories and ignores segment ordering for manual sources', () => {
  assert.notEqual(collectionDedupeKey(source, 'a'), collectionDedupeKey(source, 'b'));
  assert.notEqual(
    collectionDedupeKey(source, 'a'),
    collectionDedupeKey({ ...source, jobId: 'new' }, 'a'),
  );
  assert.equal(
    collectionDedupeKey({ ...source, tagId: null }, 'a'),
    collectionDedupeKey(
      { ...source, tagId: null, segmentIds: [...source.segmentIds].reverse() },
      'a',
    ),
  );
});
test('user can adjust roles but cannot pair suggested words with original audio', () => {
  const content = contentForSource(source, rule.category);
  validateCaseTurns(
    { ...content, turns: content.turns.map((t) => ({ ...t, role: 'customer' })) },
    turns,
  );
  assert.throws(() =>
    validateCaseTurns({ ...content, turns: [{ ...turns[1], text: 'Fabricated' }] }, turns),
  );
  assert.match(caseMarkdown(id, content), /Suggested reply \(not original audio\)/);
});
