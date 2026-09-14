/**
 * 案例筛选与对话证据策略。
 *
 * 将既有分析证据转换为真实、有序的学习轮次，不调用模型或推断未知角色。
 *
 * Responsibilities:
 * - 实现跨字段交集、同字段并集的规则匹配。
 * - 为案例保留证据上下文并生成确定性的检索正文。
 *
 * Notes:
 * - 建议话术与原销售正文始终分开。
 */
import { createHash } from 'node:crypto';
import type {
  CaseContent,
  CaseTurn,
  CollectionRuleInput,
  KnowledgeCase,
} from '@echowave/contracts';

/** 一个待收集的 AI 标签或人工修正。 */
export type CollectionSource = {
  jobId: string;
  groupId: string;
  audioFileId: string;
  dataSourceId: string | null;
  analysisRevisionId: string;
  confirmationVersion: number;
  tagId: string | null;
  correctionId: string | null;
  category: string;
  customLabel: string | null;
  title: string;
  reason: string;
  confidence: number;
  suggestedReply: string;
  segmentIds: string[];
  availableTurns: CaseTurn[];
  originalJudgment?: KnowledgeCase['source']['originalJudgment'];
  correctionSnapshot?: KnowledgeCase['source']['correctionSnapshot'];
};
/** 取完整证据跨度，并补入紧邻证据前面的顾客轮次。 */
export function selectEvidenceTurns(turns: CaseTurn[], segmentIds: string[]): CaseTurn[] {
  const selected = new Set(segmentIds);
  const indexes = turns.map((t, i) => (selected.has(t.segmentId) ? i : -1)).filter((i) => i >= 0);
  if (!indexes.length || indexes.length !== selected.size)
    throw new Error('Invalid evidence segments.');
  let first = Math.min(...indexes);
  const last = Math.max(...indexes);
  while (first > 0 && turns[first - 1]!.role === 'customer') first--;
  return turns.slice(first, last + 1);
}
/** 未配置字段不限；置信度只筛选 AI 来源，不筛选人工纠正。 */
export function matchesCollectionRule(
  rule: CollectionRuleInput,
  source: CollectionSource,
): boolean {
  const filters = rule.filters;
  if (filters.sources.length && !filters.sources.some((s) => s === source.category)) return false;
  if (filters.customLabels.length && !filters.customLabels.includes(source.customLabel ?? ''))
    return false;
  if (
    filters.dataSourceIds.length &&
    (!source.dataSourceId || !filters.dataSourceIds.includes(source.dataSourceId))
  )
    return false;
  if (
    !source.correctionId &&
    filters.minimumConfidence !== null &&
    source.confidence < filters.minimumConfidence
  )
    return false;
  const text = [
    source.title,
    source.reason,
    source.suggestedReply,
    ...selectEvidenceTurns(source.availableTurns, source.segmentIds).map((t) => t.text),
  ]
    .join('\n')
    .toLocaleLowerCase();
  return (
    !filters.keywords.length || filters.keywords.some((k) => text.includes(k.toLocaleLowerCase()))
  );
}
/** 分类映射只改变案例归类，不改动原分析标签。 */
export function contentForSource(
  source: CollectionSource,
  category: CaseContent['category'],
): CaseContent {
  return {
    category,
    title: source.title,
    reason: source.reason.slice(0, 8000),
    supplement: '',
    suggestedReply: source.suggestedReply,
    turns: selectEvidenceTurns(source.availableTurns, source.segmentIds),
  };
}
/** 校验所有播放范围和正文来自固定来源快照；角色和显示名允许人工确认。 */
export function validateCaseTurns(content: CaseContent, available: CaseTurn[]): void {
  const byId = new Map(available.map((t) => [t.segmentId, t]));
  for (const turn of content.turns) {
    const original = byId.get(turn.segmentId);
    if (
      !original ||
      original.startMs !== turn.startMs ||
      original.endMs !== turn.endMs ||
      original.text !== turn.text
    )
      throw new Error('Case turns must match the source snapshot.');
  }
}
/** 来源版本、标签或修正、目标库与类别共同组成幂等标识。 */
export function collectionDedupeKey(source: CollectionSource, categoryId: string): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        source.jobId,
        source.correctionId ?? source.tagId ?? [...source.segmentIds].sort(),
        categoryId,
      ]),
    )
    .digest('hex');
}
/** 持久任务和轮次确定媒体键，进程在复制与写回之间中断时仍能恢复和清理。 */
export function caseMediaKey(taskId: string, segmentId: string): string {
  const hex = createHash('sha256').update(`${taskId}:${segmentId}`).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}.mp3`;
}
/** 生成一个案例对应的 Markdown 检索输入，保留角色与建议边界。 */
export function caseMarkdown(id: string, content: CaseContent): string {
  return [
    `# ${content.title}`,
    `Case: ${id}`,
    `Category: ${content.category.name}`,
    '## Evaluation',
    content.reason,
    '## Original dialogue',
    ...content.turns.map(
      (t) => `${t.role} / ${t.speakerLabel} [${t.startMs}-${t.endMs}ms]: ${t.text}`,
    ),
    '## Human supplement',
    content.supplement,
    '## Suggested reply (not original audio)',
    content.suggestedReply,
  ].join('\n\n');
}
