/**
 * 报告头部的知识库分类摘要。
 *
 * 把任务审计里逐次检索的冻结分类合并成去重的分类列表，供分析报告展示。
 *
 * Responsibilities:
 * - 按分类去重并累加命中数。
 * - 在同一分类被多次检索时选择最能解释本次范围的原因。
 *
 * Notes:
 * - 只读取审计字段，不访问数据库，也不暴露检索查询与命中明细。
 * - 审计来自数据库 JSONB，脏条目按条丢弃，避免让整个发布结果解析失败。
 */

/** 分类选择原因，具体程度从高到低。 */
const REASON_PRECEDENCE = [
  'explicit',
  'auto',
  'default-route',
  'zero-hits',
  'evidence-insufficient',
] as const;

export type RetrievalReason = (typeof REASON_PRECEDENCE)[number];

/** 报告头部展示的一条分类摘要。 */
export type RetrievalCategorySummary = {
  id: string;
  name: string;
  lookupReason: RetrievalReason;
  hitCount: number;
};

function isRetrievalReason(value: unknown): value is RetrievalReason {
  return REASON_PRECEDENCE.includes(value as RetrievalReason);
}

/** 把逐次检索的审计合并为去重摘要；无效条目直接跳过。 */
export function aggregateRetrievalCategories(audit: unknown): RetrievalCategorySummary[] {
  if (!Array.isArray(audit)) return [];
  const aggregated = new Map<string, RetrievalCategorySummary>();
  for (const entry of audit) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    if (!isRetrievalReason(record.reason) || !Array.isArray(record.categories)) continue;
    const hitCount = Number.isInteger(record.hitCount) ? Number(record.hitCount) : 0;
    for (const category of record.categories) {
      if (!category || typeof category !== 'object') continue;
      const { id, name } = category as Record<string, unknown>;
      if (typeof id !== 'string' || !id || typeof name !== 'string' || !name) continue;
      const current = aggregated.get(id);
      if (!current) {
        aggregated.set(id, { id, name, lookupReason: record.reason, hitCount });
        continue;
      }
      const lookupReason =
        REASON_PRECEDENCE.indexOf(record.reason) < REASON_PRECEDENCE.indexOf(current.lookupReason)
          ? record.reason
          : current.lookupReason;
      aggregated.set(id, { ...current, lookupReason, hitCount: current.hitCount + hitCount });
    }
  }
  return [...aggregated.values()];
}
