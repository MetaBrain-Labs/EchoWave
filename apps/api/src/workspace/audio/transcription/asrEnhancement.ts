/**
 * ASR 增强配置合并策略。
 *
 * 将租户默认上下文、数据源默认热词和本次任务覆盖值合并为供应商请求可直接使用的快照。
 *
 * Responsibilities:
 * - 明确空字符串覆盖默认上下文的语义。
 * - 去重默认和临时热词，保持任务重试的一致性。
 *
 * Notes:
 * - 本模块不读取数据库，也不发起网络请求。
 */
import {
  AsrEnhancementSnapshotSchema,
  AsrHotwordsSchema,
  type AsrEnhancement,
  type AsrEnhancementSnapshot,
} from '@echowave/contracts';

/** 合并一次任务实际生效的上下文和热词。 */
export function resolveAsrEnhancement(
  defaultContext: string,
  defaultContextRevision: number,
  defaultHotwords: string[],
  override?: AsrEnhancement,
): AsrEnhancementSnapshot {
  const contextText = override?.contextText === undefined ? defaultContext : override.contextText;
  const hotwords = AsrHotwordsSchema.parse([
    ...defaultHotwords,
    ...(override?.additionalHotwords ?? []),
  ]);
  return AsrEnhancementSnapshotSchema.parse({
    contextText,
    hotwords,
    defaultContextRevision,
  });
}
