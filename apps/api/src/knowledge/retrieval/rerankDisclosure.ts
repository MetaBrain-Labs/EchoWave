/**
 * 重排披露聚合。
 *
 * 把逐次检索的审计条目（实时调用或数据库 JSONB）折算成一份面向用户的最小披露。
 *
 * Responsibilities:
 * - 状态取最坏值：任一次降级就按降级披露。
 * - 候选、入选、提升、耗时与 tokens 求和；模型与降级原因取能解释结论的代表条目。
 *
 * Notes:
 * - 只读取审计字段，不访问数据库，也不暴露候选正文与相关性分数。
 * - 审计来自 JSONB，脏条目按条丢弃，避免整体失败。
 */
import { RerankDisclosureSchema, type RerankDisclosure } from '@echowave/contracts';

type RerankStatus = RerankDisclosure['status'];

/** 状态严重程度：降级优先于生效，生效优先于关闭。 */
const STATUS_PRECEDENCE: readonly RerankStatus[] = ['fallback', 'applied', 'disabled'];

function isStatus(value: unknown): value is RerankStatus {
  return typeof value === 'string' && STATUS_PRECEDENCE.includes(value as RerankStatus);
}

function count(value: unknown): number {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

function text(value: unknown, maximum: number): string | null {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, maximum) : null;
}

/**
 * 把逐次检索的审计折算为一份重排披露；没有任何条目提到重排时返回 undefined。
 *
 * 调用方可以直接传入实时检索的 audit 数组，也可以传入数据库里的 `retrieval_audit` JSONB。
 */
export function readRerankDisclosure(entries: unknown): RerankDisclosure | undefined {
  if (!Array.isArray(entries)) return undefined;
  const relevant = entries.filter(
    (entry): entry is Record<string, unknown> =>
      Boolean(entry) &&
      typeof entry === 'object' &&
      isStatus((entry as Record<string, unknown>).rerankStatus),
  );
  if (!relevant.length) return undefined;

  let status: RerankStatus = 'disabled';
  let fallbackReason: string | null = null;
  let model: string | null = null;
  let candidateCount = 0;
  let selectedCount = 0;
  let promotedCount = 0;
  let reordered = false;
  let measured = false;
  let durationMs = 0;
  let tokens = 0;
  for (const entry of relevant) {
    const entryStatus = entry.rerankStatus as RerankStatus;
    if (STATUS_PRECEDENCE.indexOf(entryStatus) < STATUS_PRECEDENCE.indexOf(status)) {
      status = entryStatus;
    }
    fallbackReason ??= text(entry.fallbackReason, 80);
    model ??= text(entry.rerankerModel, 160);
    candidateCount += count(entry.candidateCount);
    selectedCount += count(entry.selectedCount ?? (entry.finalChunkIds as unknown[])?.length);
    promotedCount += count(entry.promotedCount);
    reordered ||= entry.reordered === true;
    // 早于效果字段的审计没有这两个键，据此区分"测过且没变化"与"无法判断"。
    measured ||= Number.isInteger(entry.promotedCount) || typeof entry.reordered === 'boolean';
    durationMs += count(entry.rerankDurationMs);
    tokens += count(entry.rerankTokens);
  }
  // 降级与未测量的审计都不能声称提升：那时入选集合仍是向量顺序。
  if (status !== 'applied' || !measured) {
    promotedCount = 0;
    reordered = false;
  }
  return RerankDisclosureSchema.parse({
    status,
    model,
    candidateCount,
    selectedCount,
    promotedCount,
    reordered,
    measured,
    durationMs,
    tokens,
    fallbackReason: status === 'fallback' ? fallbackReason : null,
  });
}
