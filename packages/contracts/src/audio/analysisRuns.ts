/**
 * 统一分析运行记录契约。
 *
 * 为移动端分析工作区提供批次与手动音频分析的统一状态、进度和跳转信息。
 *
 * Responsibilities:
 * - 约束运行记录筛选参数与批次/手动音频判别联合。
 * - 保持报告入口只指向当前已发布的业务分析结果。
 *
 * Notes:
 * - 该契约只描述只读聚合结果，不替代各阶段任务的持久化状态。
 */
import { z } from 'zod';

import { EntityIdSchema } from '../common.ts';
import { AudioAnalysisTaskPhaseSchema, AudioAnalysisTaskStatusSchema } from './automation.ts';

export const AudioAnalysisRunKindSchema = z.enum(['batch', 'manual_audio']);
export const AudioAnalysisRunStatusFilterSchema = z.enum([
  'all',
  'active',
  'completed',
  'failed',
  'canceled',
]);

export const AudioAnalysisRunsQuerySchema = z.object({
  status: AudioAnalysisRunStatusFilterSchema.default('all'),
  kind: AudioAnalysisRunKindSchema.or(z.literal('all')).default('all'),
  limit: z.coerce.number().int().min(1).max(50).default(50),
});

const AudioAnalysisRunCountsSchema = z.object({
  total: z.number().int().nonnegative(),
  active: z.number().int().nonnegative(),
  blocked: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  partial: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  canceled: z.number().int().nonnegative(),
});

const AudioAnalysisRunErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean(),
});

export const AudioAnalysisRunSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('batch'),
    id: EntityIdSchema,
    title: z.string().min(1),
    groupId: EntityIdSchema,
    status: AudioAnalysisTaskStatusSchema,
    progress: z.number().int().min(0).max(100),
    scheduledFor: z.string().datetime().nullable(),
    counts: AudioAnalysisRunCountsSchema,
    updatedAt: z.string().datetime(),
  }),
  z.object({
    kind: z.literal('manual_audio'),
    id: EntityIdSchema,
    audioFileId: EntityIdSchema,
    groupId: EntityIdSchema.nullable(),
    title: z.string().min(1),
    status: AudioAnalysisTaskStatusSchema,
    phase: AudioAnalysisTaskPhaseSchema,
    progress: z.number().int().min(0).max(100),
    reportAvailable: z.boolean(),
    warningCodes: z.array(z.string()),
    error: AudioAnalysisRunErrorSchema.nullable(),
    updatedAt: z.string().datetime(),
  }),
]);

export const AudioAnalysisRunsResponseSchema = z.object({
  items: z.array(AudioAnalysisRunSchema),
});

export type AudioAnalysisRunKind = z.infer<typeof AudioAnalysisRunKindSchema>;
export type AudioAnalysisRunsQuery = z.infer<typeof AudioAnalysisRunsQuerySchema>;
export type AudioAnalysisRun = z.infer<typeof AudioAnalysisRunSchema>;
export type AudioAnalysisRunsResponse = z.infer<typeof AudioAnalysisRunsResponseSchema>;
