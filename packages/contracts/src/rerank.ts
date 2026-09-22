/**
 * 智能重排披露契约。
 *
 * 定义一次回答、一条历史记录或一份分析报告向用户公开的重排状态与量化效果。
 *
 * Responsibilities:
 * - 用同一结构描述实时回答、历史记录、业务分析报告和执行轨迹里的重排披露。
 * - 只暴露可复算的计数与状态，不包含候选正文、相关性分数或 Credential。
 *
 * Notes:
 * - `promotedCount` 是"重排后入选集合中，纯向量顺序不会入选的片段数"，属于效果代理指标，
 *   不是答案质量评分；`reordered` 表示入选集合顺序是否变化。
 * - `measured` 区分"测过且没变化"与"这条审计早于效果字段、无法判断"：为 false 时客户端只能
 *   说明使用了重排，不得声称结果与向量召回一致。
 * - 作为可选字段挂到既有载荷上，父对象都不是 strict，旧客户端可以安全忽略未知字段。
 */
import { z } from 'zod';

/** 一次检索的重排披露。 */
export const RerankDisclosureSchema = z
  .object({
    status: z.enum(['applied', 'disabled', 'fallback']),
    model: z.string().min(1).max(160).nullable(),
    candidateCount: z.number().int().nonnegative(),
    selectedCount: z.number().int().nonnegative(),
    promotedCount: z.number().int().nonnegative(),
    reordered: z.boolean(),
    measured: z.boolean(),
    durationMs: z.number().int().nonnegative(),
    tokens: z.number().int().nonnegative(),
    fallbackReason: z.string().min(1).max(80).nullable(),
  })
  .strict();

export type RerankDisclosure = z.infer<typeof RerankDisclosureSchema>;
