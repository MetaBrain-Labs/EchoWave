/**
 * 销售复盘网络契约。
 *
 * 定义业务分析标签、知识引用、发布结果、任务状态和启动请求响应。
 *
 * Responsibilities:
 * - 校验证据 ID、标签分类和结果唯一性。
 * - 描述当前分组的任务状态与上一成功结果。
 */
import { z } from 'zod';

import { EntityIdSchema } from '../common.ts';
import { SourceLocatorSchema } from '../document.ts';

export const BusinessAnalysisTagCategorySchema = z.enum([
  'strength',
  'improvement',
  'risk',
  'suggestion',
  'custom',
]);
export const BusinessAnalysisCitationSchema = z.object({
  chunkId: EntityIdSchema,
  knowledgeBaseId: EntityIdSchema,
  documentId: EntityIdSchema,
  documentTitle: z.string().min(1),
  excerpt: z.string().trim().min(1).max(240),
  locator: SourceLocatorSchema,
});
export const BusinessAnalysisTagSchema = z
  .object({
    id: EntityIdSchema,
    category: BusinessAnalysisTagCategorySchema,
    customLabel: z.string().trim().min(1).max(24).nullable(),
    title: z.string().trim().min(1).max(120),
    summary: z.string().trim().min(1).max(2_000),
    details: z.array(z.string().trim().min(1).max(1_000)).max(8),
    confidence: z.number().int().min(0).max(100),
    evidenceSegmentIds: z.array(EntityIdSchema).min(1).max(50),
    citations: z.array(BusinessAnalysisCitationSchema).max(12),
  })
  .superRefine((input, context) => {
    if (new Set(input.evidenceSegmentIds).size !== input.evidenceSegmentIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['evidenceSegmentIds'],
        message: 'evidenceSegmentIds must be unique.',
      });
    }
    if (input.category === 'custom' && input.customLabel === null) {
      context.addIssue({
        code: 'custom',
        path: ['customLabel'],
        message: 'customLabel is required for custom tags.',
      });
    }
    if (input.category !== 'custom' && input.customLabel !== null) {
      context.addIssue({
        code: 'custom',
        path: ['customLabel'],
        message: 'customLabel is only allowed for custom tags.',
      });
    }
  });
export const BusinessAnalysisResultSchema = z
  .object({
    jobId: EntityIdSchema,
    groupId: EntityIdSchema,
    confirmationVersion: z.number().int().positive(),
    model: z.string().min(1),
    generatedAt: z.string().datetime(),
    knowledgeBaseIds: z.array(EntityIdSchema),
    knowledgeStatus: z.enum(['not_linked', 'linked_not_used', 'used']),
    limitations: z.array(z.string().trim().min(1).max(500)).max(8),
    summarySections: z.array(
      z.object({
        id: EntityIdSchema,
        index: z.number().int().positive(),
        title: z.string(),
        body: z.string(),
      }),
    ),
    tags: z.array(BusinessAnalysisTagSchema),
  })
  .superRefine((input, context) => {
    const uniqueFields = [
      ['knowledgeBaseIds', input.knowledgeBaseIds],
      ['summarySections', input.summarySections.map((section) => section.id)],
      ['tags', input.tags.map((tag) => tag.id)],
    ] as const;
    for (const [path, values] of uniqueFields) {
      if (new Set(values).size !== values.length) {
        context.addIssue({ code: 'custom', path: [path], message: `${path} IDs must be unique.` });
      }
    }
  });
export const AudioBusinessAnalysisStateSchema = z.object({
  state: z.enum(['idle', 'queued', 'running', 'ready', 'failed']),
  groupId: EntityIdSchema.nullable().default(null),
  jobId: EntityIdSchema.nullable(),
  model: z.string().nullable(),
  progress: z.number().int().min(0).max(100),
  confirmationVersion: z.number().int().positive().nullable(),
  settingsCurrent: z.boolean(),
  knowledgeCurrent: z.boolean(),
  error: z
    .object({ code: z.string().min(1), message: z.string().min(1), retryable: z.boolean() })
    .nullable(),
  result: BusinessAnalysisResultSchema.nullable(),
});
export const AudioBusinessAnalysisStartRequestSchema = z.object({
  groupId: EntityIdSchema,
  force: z.boolean().default(false),
});
export const AudioBusinessAnalysisStartResponseSchema = z.object({
  audioFileId: EntityIdSchema,
  groupId: EntityIdSchema,
  revisionId: EntityIdSchema,
  jobId: EntityIdSchema,
  status: z.enum(['queued', 'running', 'ready']),
  reused: z.boolean(),
});

export type BusinessAnalysisTagCategory = z.infer<typeof BusinessAnalysisTagCategorySchema>;
export type BusinessAnalysisCitation = z.infer<typeof BusinessAnalysisCitationSchema>;
export type BusinessAnalysisTag = z.infer<typeof BusinessAnalysisTagSchema>;
export type BusinessAnalysisResult = z.infer<typeof BusinessAnalysisResultSchema>;
export type AudioBusinessAnalysisState = z.infer<typeof AudioBusinessAnalysisStateSchema>;
export type AudioBusinessAnalysisStartRequest = z.infer<
  typeof AudioBusinessAnalysisStartRequestSchema
>;
export type AudioBusinessAnalysisStartResponse = z.infer<
  typeof AudioBusinessAnalysisStartResponseSchema
>;
