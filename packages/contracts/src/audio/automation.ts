/**
 * 音频自动分析批次网络契约。
 *
 * 定义新上传或已有音频进入服务端完整分析流水线时使用的请求、状态和实时事件。
 *
 * Responsibilities:
 * - 约束批次规模、一次性计划时间和自动分析状态机。
 * - 为移动端提供可恢复、可取消且可审计的任务快照。
 *
 * Notes:
 * - 一个批次只绑定一个数据源和一个分组，服务端在入队时冻结配置。
 */
import { z } from 'zod';

import { EntityIdSchema } from '../common.ts';
import { AudioRuntimeModeSchema, AudioUploadSessionResponseSchema } from './runtime.ts';

export const AudioAnalysisTaskStatusSchema = z.enum([
  'awaiting_upload',
  'scheduled',
  'queued',
  'running',
  'hard_blocked',
  'completed',
  'completed_with_warnings',
  'failed',
  'canceled',
]);

export const AudioAnalysisTaskPhaseSchema = z.enum([
  'upload',
  'transcription',
  'post_analysis',
  'business_analysis',
  'done',
]);

export const AudioAnalysisBlockReasonSchema = z.enum([
  'API_QUOTA_EXCEEDED',
  'INVALID_CREDENTIALS',
  'CONFIGURATION_REQUIRED',
  'SOURCE_REMOUNT_REQUIRED',
]);

export const AudioAnalysisPipelineOptionsSchema = z
  .object({
    confirmation: z.literal('system_raw_snapshot').default('system_raw_snapshot'),
    includeEmotion: z.boolean().default(true),
    includeRole: z.boolean().default(true),
    includeBusinessAnalysis: z.boolean().default(true),
    transcriptPolicy: z.literal('reuse_or_create').default('reuse_or_create'),
  })
  .strict();

export const AudioAnalysisUploadItemSchema = z
  .object({
    clientItemId: z.string().trim().min(1).max(80),
    filename: z.string().trim().min(1).max(255),
    mimeType: z.string().trim().min(1).max(160),
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(200 * 1024 * 1024),
  })
  .strict();

const AudioAnalysisBatchBaseSchema = z.object({
  dataSourceId: EntityIdSchema,
  groupId: EntityIdSchema,
  scheduledFor: z.string().datetime().nullable().default(null),
  pipeline: AudioAnalysisPipelineOptionsSchema.default({
    confirmation: 'system_raw_snapshot',
    includeEmotion: true,
    includeRole: true,
    includeBusinessAnalysis: true,
    transcriptPolicy: 'reuse_or_create',
  }),
});

export const AudioAnalysisBatchCreateRequestSchema = z.discriminatedUnion('source', [
  AudioAnalysisBatchBaseSchema.extend({
    source: z.literal('uploads'),
    items: z.array(AudioAnalysisUploadItemSchema).min(1).max(20),
  })
    .strict()
    .superRefine((input, context) => {
      if (new Set(input.items.map((item) => item.clientItemId)).size !== input.items.length) {
        context.addIssue({
          code: 'custom',
          path: ['items'],
          message: 'clientItemId must be unique.',
        });
      }
      const total = input.items.reduce((sum, item) => sum + item.sizeBytes, 0);
      if (total > 200 * 1024 * 1024) {
        context.addIssue({
          code: 'custom',
          path: ['items'],
          message: 'Total upload size must not exceed 200 MB.',
        });
      }
    }),
  AudioAnalysisBatchBaseSchema.extend({
    source: z.literal('existing_audio'),
    audioFileIds: z.array(EntityIdSchema).min(1).max(20),
  })
    .strict()
    .superRefine((input, context) => {
      if (new Set(input.audioFileIds).size !== input.audioFileIds.length) {
        context.addIssue({
          code: 'custom',
          path: ['audioFileIds'],
          message: 'ids must be unique.',
        });
      }
    }),
]);

export const AudioAnalysisTaskSchema = z
  .object({
    id: EntityIdSchema,
    batchId: EntityIdSchema,
    audioFileId: EntityIdSchema.nullable(),
    title: z.string().min(1),
    runtimeMode: AudioRuntimeModeSchema.nullable(),
    status: AudioAnalysisTaskStatusSchema,
    phase: AudioAnalysisTaskPhaseSchema,
    progress: z.number().int().min(0).max(100),
    runAfter: z.string().datetime().nullable(),
    warningCodes: z.array(z.string()),
    blocker: z
      .object({
        reason: AudioAnalysisBlockReasonSchema,
        capability: z.string().min(1),
        message: z.string().min(1),
        sourceExpiresAt: z.string().datetime().nullable(),
      })
      .nullable(),
    error: z
      .object({ code: z.string().min(1), message: z.string().min(1), retryable: z.boolean() })
      .nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const AudioAnalysisBatchSchema = z
  .object({
    id: EntityIdSchema,
    dataSourceId: EntityIdSchema,
    groupId: EntityIdSchema,
    source: z.enum(['uploads', 'existing_audio']),
    scheduledFor: z.string().datetime().nullable(),
    configurationSnapshot: z.object({
      groupName: z.string().min(1),
      analysisTiming: z.enum(['automatic', 'manual']),
      contentFocus: z.string().min(1),
      tone: z.string().min(1),
      customTags: z.array(z.string()),
      knowledgeBaseIds: z.array(EntityIdSchema),
      capabilityBindings: z.object({
        transcription: EntityIdSchema.nullable(),
        staging: EntityIdSchema.nullable(),
        emotion: EntityIdSchema.nullable(),
        role: EntityIdSchema.nullable(),
        businessAnalysis: EntityIdSchema.nullable(),
        knowledgeEmbedding: EntityIdSchema.nullable(),
      }),
      models: z.object({
        transcription: z.string().nullable(),
        emotion: z.string().nullable(),
        role: z.string().nullable(),
        businessAnalysis: z.string().nullable(),
      }),
    }),
    counts: z.object({
      total: z.number().int().nonnegative(),
      active: z.number().int().nonnegative(),
      blocked: z.number().int().nonnegative(),
      completed: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
    }),
    tasks: z.array(AudioAnalysisTaskSchema),
    createdAt: z.string().datetime(),
  })
  .strict();

export const AudioAnalysisBatchCreateResponseSchema = z
  .object({
    batch: AudioAnalysisBatchSchema,
    uploads: z.array(
      z.object({
        clientItemId: z.string().min(1),
        taskId: EntityIdSchema,
        session: AudioUploadSessionResponseSchema,
      }),
    ),
  })
  .strict();

export const AudioAnalysisBatchListResponseSchema = z.object({
  items: z.array(AudioAnalysisBatchSchema),
});

export const AudioAnalysisResumeResponseSchema = z.object({
  resumedTaskIds: z.array(EntityIdSchema),
});
export const AudioAnalysisCancelResponseSchema = z.object({
  canceledTaskIds: z.array(EntityIdSchema),
});

export const AudioAnalysisBatchStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('snapshot'), batch: AudioAnalysisBatchSchema }),
  z.object({ type: z.literal('refresh'), batchId: EntityIdSchema }),
  z.object({ type: z.literal('heartbeat') }),
  z.object({
    type: z.literal('error'),
    error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean() }),
  }),
]);

export type AudioAnalysisTaskStatus = z.infer<typeof AudioAnalysisTaskStatusSchema>;
export type AudioAnalysisTaskPhase = z.infer<typeof AudioAnalysisTaskPhaseSchema>;
export type AudioAnalysisBlockReason = z.infer<typeof AudioAnalysisBlockReasonSchema>;
export type AudioAnalysisPipelineOptions = z.infer<typeof AudioAnalysisPipelineOptionsSchema>;
export type AudioAnalysisBatchCreateRequest = z.infer<typeof AudioAnalysisBatchCreateRequestSchema>;
export type AudioAnalysisTask = z.infer<typeof AudioAnalysisTaskSchema>;
export type AudioAnalysisBatch = z.infer<typeof AudioAnalysisBatchSchema>;
export type AudioAnalysisBatchCreateResponse = z.infer<
  typeof AudioAnalysisBatchCreateResponseSchema
>;
export type AudioAnalysisBatchStreamEvent = z.infer<typeof AudioAnalysisBatchStreamEventSchema>;
