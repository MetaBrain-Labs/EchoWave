/**
 * 分析案例收集网络契约。
 *
 * 定义可扩展收集规则、人工纠正、版本化案例与任务状态。
 *
 * Responsibilities:
 * - 在客户端和服务器边界验证规则、轮次和乐观版本。
 * - 分开表达知识发布与独立音频的可用性。
 *
 * Notes:
 * - 存储键、凭据和租约不进入公开契约。
 */
import { z } from 'zod';
import { EntityIdSchema } from './common.ts';
import { BusinessAnalysisTagCategorySchema } from './analysis/businessAnalysis.ts';

/** 三种收集模式，创建规则默认进入人工精选。 */
export const CollectionModeSchema = z.enum(['review', 'direct', 'manual']);
/** 类别标识独立于可编辑名称，新增类别无需修改固定枚举。 */
export const CollectionCategorySchema = z.object({
  id: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(80),
});
/** 同字段多选取并集，不同筛选字段取交集。 */
export const CollectionFiltersSchema = z.object({
  sources: z
    .array(z.enum(['strength', 'improvement', 'risk', 'suggestion', 'custom', 'correction']))
    .max(6)
    .default([]),
  customLabels: z.array(z.string().trim().min(1).max(24)).max(12).default([]),
  dataSourceIds: z.array(EntityIdSchema).max(100).default([]),
  minimumConfidence: z.number().int().min(0).max(100).nullable().default(null),
  keywords: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
});
/** 保存完整规则；禁用或修改只影响后续事件。 */
export const CollectionRuleInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    enabled: z.boolean().default(true),
    mode: CollectionModeSchema.default('review'),
    category: CollectionCategorySchema,
    knowledgeBaseId: EntityIdSchema,
    filters: CollectionFiltersSchema,
  })
  .strict();
/** 持久规则及当前乐观版本。 */
export const CollectionRuleSchema = CollectionRuleInputSchema.extend({
  id: EntityIdSchema,
  groupId: EntityIdSchema,
  version: z.number().int().positive(),
  updatedAt: z.string().datetime(),
});
/** 规则修改必须提供读取时版本。 */
export const CollectionRuleUpdateSchema = CollectionRuleInputSchema.extend({
  expectedVersion: z.number().int().positive(),
});
/** 人工纠正与原 AI 结果分别保存。 */
export const AnalysisCorrectionInputSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    category: BusinessAnalysisTagCategorySchema,
    customLabel: z.string().trim().min(1).max(24).nullable().default(null),
    reason: z.string().trim().min(1).max(4000),
    suggestedReply: z.string().trim().max(4000).default(''),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.category === 'custom') !== (value.customLabel !== null))
      ctx.addIssue({
        code: 'custom',
        path: ['customLabel'],
        message: 'A custom category requires a custom label; other categories must not have one.',
      });
  });
/** 保留每次人工纠正的版本及原始标签定位。 */
export const AnalysisCorrectionSchema = z.object({
  id: EntityIdSchema,
  jobId: EntityIdSchema,
  tagId: EntityIdSchema,
  version: z.number().int().positive(),
  category: BusinessAnalysisTagCategorySchema,
  customLabel: z.string().nullable(),
  reason: z.string(),
  suggestedReply: z.string(),
  createdAt: z.string().datetime(),
});
/** 一个学习轮次始终来自真实片段；角色可由用户明确校正。 */
export const CaseTurnSchema = z
  .object({
    segmentId: EntityIdSchema,
    speakerLabel: z.string().min(1).max(120),
    role: z.enum(['customer', 'sales', 'unknown']),
    text: z.string().min(1).max(20000),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
  })
  .strict()
  .refine((v) => v.endMs > v.startMs, { message: 'Invalid turn time range.' });
/** 案例正文是唯一编辑入口，检索文档由此生成。 */
export const CaseContentSchema = z
  .object({
    category: CollectionCategorySchema,
    title: z.string().trim().min(1).max(255),
    reason: z.string().trim().min(1).max(8000),
    supplement: z.string().max(8000).default(''),
    suggestedReply: z.string().max(8000).default(''),
    turns: z.array(CaseTurnSchema).min(1).max(200),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.turns.map((t) => t.segmentId)).size !== value.turns.length)
      ctx.addIssue({
        code: 'custom',
        path: ['turns'],
        message: 'Turn segment IDs must be unique.',
      });
    if (value.turns.some((turn, i) => i > 0 && turn.startMs < value.turns[i - 1]!.startMs))
      ctx.addIssue({
        code: 'custom',
        path: ['turns'],
        message: 'Turns must be in chronological order.',
      });
  });
/** 手动标签收集或片段收集使用同一来源版本。 */
export const ManualCollectionRequestSchema = z
  .object({
    jobId: EntityIdSchema,
    tagId: EntityIdSchema.optional(),
    correctionId: EntityIdSchema.optional(),
    segmentIds: z.array(EntityIdSchema).min(1).max(200).optional(),
    knowledgeBaseId: EntityIdSchema,
    category: CollectionCategorySchema,
    content: CaseContentSchema.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if ([v.tagId, v.correctionId, v.segmentIds].filter(Boolean).length !== 1)
      ctx.addIssue({
        code: 'custom',
        message: 'Select exactly one tag, correction or dialogue segment selection.',
      });
  });
/** 版本冲突时客户端保留尚未保存的编辑。 */
export const CaseUpdateRequestSchema = z
  .object({ expectedVersion: z.number().int().positive(), content: CaseContentSchema })
  .strict();
/** 审核操作支持单项和批量，逐项检查版本。 */
export const CaseActionRequestSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    action: z.enum(['publish', 'reject', 'withdraw', 'delete', 'retry']),
  })
  .strict();
/** 音频状态不与文本向量化状态合并。 */
export const CaseMediaSchema = z.object({
  segmentId: EntityIdSchema,
  status: z.enum(['pending', 'ready', 'missing', 'failed']),
  message: z.string().nullable(),
  url: z.string().nullable(),
});
/** 正式案例及不可变的来源定位。 */
export const KnowledgeCaseSchema = z.object({
  id: EntityIdSchema,
  groupId: EntityIdSchema,
  knowledgeBaseId: EntityIdSchema,
  version: z.number().int().positive(),
  status: z.enum(['candidate', 'published', 'rejected', 'withdrawn', 'deleted']),
  origin: z.enum(['automatic', 'manual']),
  source: z.object({
    audioFileId: EntityIdSchema,
    jobId: EntityIdSchema,
    tagId: EntityIdSchema.nullable(),
    correctionId: EntityIdSchema.nullable(),
    analysisRevisionId: EntityIdSchema,
    confirmationVersion: z.number().int().positive(),
    collectionMode: CollectionModeSchema.default('review'),
    originalJudgment: z
      .object({
        category: BusinessAnalysisTagCategorySchema,
        customLabel: z.string().nullable(),
        reason: z.string(),
        confidence: z.number(),
      })
      .optional(),
    correctionSnapshot: z
      .object({
        version: z.number().int().positive(),
        category: BusinessAnalysisTagCategorySchema,
        customLabel: z.string().nullable(),
        reason: z.string(),
        suggestedReply: z.string(),
      })
      .optional(),
  }),
  sourceUpdated: z.boolean(),
  content: CaseContentSchema,
  availableTurns: z.array(CaseTurnSchema),
  documentId: EntityIdSchema.nullable(),
  publication: z.enum(['not_requested', 'pending', 'ready', 'failed']),
  publicationMessage: z.string().nullable(),
  publicationRetryable: z.boolean().optional(),
  media: z.array(CaseMediaSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
/** 指定时间范围的历史补收；只扫描每份音频的最新成功结果。 */
export const CollectionHistoryRequestSchema = z
  .object({ ruleId: EntityIdSchema, from: z.string().datetime(), to: z.string().datetime() })
  .strict()
  .refine((v) => Date.parse(v.to) >= Date.parse(v.from), {
    message: 'Invalid history time range.',
  });
/** 补收预览匹配数量。 */
export const CollectionPreviewSchema = z.object({ count: z.number().int().nonnegative() });
/** 持久任务公开安全错误及处理进度。 */
export const CollectionRunSchema = z.object({
  id: EntityIdSchema,
  groupId: EntityIdSchema,
  status: z.enum(['queued', 'running', 'completed', 'failed']),
  total: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  error: z.string().nullable(),
  createdAt: z.string().datetime(),
});
/** 分组规则列表响应。 */
export const CollectionRuleListSchema = z.object({ items: z.array(CollectionRuleSchema) });
/** 人工纠正历史响应。 */
export const AnalysisCorrectionListSchema = z.object({ items: z.array(AnalysisCorrectionSchema) });
/** 候选与正式案例列表响应。 */
export const KnowledgeCaseListSchema = z.object({ items: z.array(KnowledgeCaseSchema) });
/** 持久收集任务进度列表响应。 */
export const CollectionRunListSchema = z.object({ items: z.array(CollectionRunSchema) });
/** 手动收集时恢复分析任务实际使用的轮次与标签。 */
export const CollectionCaptureSchema = z.object({
  jobId: EntityIdSchema,
  groupId: EntityIdSchema,
  availableTurns: z.array(CaseTurnSchema),
  tags: z.array(
    z.object({
      id: EntityIdSchema,
      category: BusinessAnalysisTagCategorySchema,
      customLabel: z.string().nullable(),
      title: z.string(),
      reason: z.string(),
      segmentIds: z.array(EntityIdSchema),
    }),
  ),
});
/** 手动收集固定来源的推断类型由契约层导出。 */
export type CollectionCapture = z.infer<typeof CollectionCaptureSchema>;
/** 逐项携带当前版本的批量审核请求。 */
export const CaseBatchRequestSchema = z.object({
  items: z
    .array(z.object({ id: EntityIdSchema, ...CaseActionRequestSchema.shape }))
    .min(1)
    .max(100),
});
/** 逐项保留失败结果的批量审核响应。 */
export const CaseBatchResponseSchema = z.object({
  items: z.array(
    z.object({ id: EntityIdSchema, success: z.boolean(), message: z.string().nullable() }),
  ),
});
/** 共享规则类型。 */
export type CollectionRule = z.infer<typeof CollectionRuleSchema>;
/** 完整规则写入类型。 */
export type CollectionRuleInput = z.infer<typeof CollectionRuleInputSchema>;
/** 不可变人工纠正版本。 */
export type AnalysisCorrection = z.infer<typeof AnalysisCorrectionSchema>;
/** 带乐观版本的纠正写入。 */
export type AnalysisCorrectionInput = z.infer<typeof AnalysisCorrectionInputSchema>;
/** 权威案例详情。 */
export type KnowledgeCase = z.infer<typeof KnowledgeCaseSchema>;
/** 可编辑案例正文与真实轮次。 */
export type CaseContent = z.infer<typeof CaseContentSchema>;
/** 来源固定的顾客或销售对话轮次。 */
export type CaseTurn = z.infer<typeof CaseTurnSchema>;
/** 手动来源选择和目标库。 */
export type ManualCollectionRequest = z.infer<typeof ManualCollectionRequestSchema>;
/** 指定规则和时间范围的补收请求。 */
export type CollectionHistoryRequest = z.infer<typeof CollectionHistoryRequestSchema>;
/** 收集批次权威进度。 */
export type CollectionRun = z.infer<typeof CollectionRunSchema>;
