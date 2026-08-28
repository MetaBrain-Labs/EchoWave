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

export const DEFAULT_GROUP_ANALYSIS_FOCUS =
  '重点分析销售话术的有效性，提炼表现优秀之处及其对话证据，指出待改进点、潜在风险和可执行优化建议；结合客户回应、销售阶段、异议处理、需求探索、价值表达、促成动作与关联知识库进行判断；所有结论必须引用实际转写片段，不得补充录音外事实。';
export const DEFAULT_GROUP_ANALYSIS_TONE = '正式、专业、结构清晰';

/** 分组确认转写后的业务分析触发方式。 */
export const GroupAnalysisTimingSchema = z.enum(['automatic', 'manual']);

/** 分组分析设置；用户文本只能作为受限提示配置，不能覆盖服务端安全规则。 */
export const GroupAnalysisSettingsSchema = z
  .object({
    timing: GroupAnalysisTimingSchema,
    contentFocus: z.string().trim().min(1).max(4_000),
    tone: z.string().trim().min(1).max(1_000),
    customTags: z.array(z.string().trim().min(1).max(24)).max(12),
  })
  .superRefine((input, context) => {
    if (new Set(input.customTags).size !== input.customTags.length) {
      context.addIssue({
        code: 'custom',
        path: ['customTags'],
        message: 'customTags must be unique.',
      });
    }
  });

/** 分组设置页读取模型。 */
export const GroupSettingsSchema = z.object({
  groupId: EntityIdSchema,
  name: z.string().min(1).max(120),
  analysis: GroupAnalysisSettingsSchema,
  updatedAt: z.string().datetime(),
});

/** 保存分组名称和完整分析配置。 */
export const GroupSettingsUpdateRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  analysis: GroupAnalysisSettingsSchema,
});

/** 原子替换分组资源关联集合。 */
export const GroupResourceLinksUpdateRequestSchema = z
  .object({ ids: z.array(EntityIdSchema).max(500) })
  .superRefine((input, context) => {
    if (new Set(input.ids).size !== input.ids.length) {
      context.addIssue({ code: 'custom', path: ['ids'], message: 'ids must be unique.' });
    }
  });

/** 创建分组时接受的名称，写入前统一去除首尾空白。 */
export const GroupCreateRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

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
export type GroupCreateRequest = z.infer<typeof GroupCreateRequestSchema>;
export type GroupAnalysisTiming = z.infer<typeof GroupAnalysisTimingSchema>;
export type GroupAnalysisSettings = z.infer<typeof GroupAnalysisSettingsSchema>;
export type GroupSettings = z.infer<typeof GroupSettingsSchema>;
export type GroupSettingsUpdateRequest = z.infer<typeof GroupSettingsUpdateRequestSchema>;
export type GroupResourceLinksUpdateRequest = z.infer<typeof GroupResourceLinksUpdateRequestSchema>;
