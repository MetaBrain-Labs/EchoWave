/**
 * 分组工作区网络契约。
 *
 * 定义分组目录、详情与聚合指标，具体音频、知识库和数据源列表由各自领域契约负责。
 *
 * Responsibilities:
 * - 校验分组摘要和服务端聚合计数。
 *
 * Notes:
 * - 所有计数均由服务端关系查询生成，不是可写业务字段。
 */
import { z } from 'zod';

import { EntityIdSchema } from './common.ts';

/** 分组页面展示的四项聚合指标。 */
export const GroupMetricsSchema = z.object({
  analysisCount: z.number().int().nonnegative(),
  audioCount: z.number().int().nonnegative(),
  knowledgeCount: z.number().int().nonnegative(),
  sourceCount: z.number().int().nonnegative(),
});

/** 分组目录与详情共用的摘要。 */
export const GroupSummarySchema = z.object({
  id: EntityIdSchema,
  name: z.string(),
  metrics: GroupMetricsSchema,
  updatedAt: z.string().datetime(),
});

export const GroupListResponseSchema = z.object({ items: z.array(GroupSummarySchema) });
export const GroupDetailSchema = GroupSummarySchema;

export type GroupMetrics = z.infer<typeof GroupMetricsSchema>;
export type GroupSummary = z.infer<typeof GroupSummarySchema>;
