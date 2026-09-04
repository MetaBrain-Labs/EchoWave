/**
 * 音频处理生命周期网络契约。
 *
 * 定义音频摘要、上传到分析的状态以及可安全展示的失败诊断。
 *
 * Responsibilities:
 * - 校验音频文件摘要和统一处理状态。
 * - 限制失败详情，避免暴露模型或供应商原文。
 */
import { z } from 'zod';

import { EntityIdSchema } from '../common.ts';

export const AudioFailureStageSchema = z.enum(['upload', 'transcription', 'analysis']);
export const AudioFailureDiagnosticCategorySchema = z.enum([
  'invalid_json',
  'schema_validation',
  'semantic_validation',
  'provider',
  'timeout',
  'preprocessing',
  'internal',
]);
export const AudioFailureIssueSchema = z.object({
  path: z.string().max(200),
  code: z.string().min(1).max(80),
  message: z.string().min(1).max(500),
});
export const AudioFailureDetailsSchema = z.object({
  category: AudioFailureDiagnosticCategorySchema,
  chunkIndex: z.number().int().positive().nullable(),
  chunkCount: z.number().int().positive().nullable(),
  structureAttempts: z.number().int().min(0).max(3),
  issues: z.array(AudioFailureIssueSchema).max(20),
  outputLength: z.number().int().nonnegative().nullable(),
  outputSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
});
export const AudioTranscriptionStageSchema = z.enum([
  'queued',
  'preprocessing',
  'transcribing',
  'awaiting_result',
  'validating',
  'correcting',
  'splitting',
  'merging',
  'publishing',
]);
export const AudioTranscriptionActivitySchema = z
  .object({
    stage: AudioTranscriptionStageSchema,
    chunkIndex: z.number().int().positive().nullable(),
    chunkCount: z.number().int().positive().nullable(),
    chunkStartMs: z.number().int().nonnegative().nullable(),
    chunkEndMs: z.number().int().positive().nullable(),
    networkAttempt: z.number().int().min(1).max(3).nullable(),
    structureAttempt: z.number().int().min(1).max(3).nullable(),
    updatedAt: z.string().datetime(),
  })
  .superRefine((activity, context) => {
    const chunkValues = [
      activity.chunkIndex,
      activity.chunkCount,
      activity.chunkStartMs,
      activity.chunkEndMs,
    ];
    const hasChunk = chunkValues.every((value) => value !== null);
    if (!hasChunk && chunkValues.some((value) => value !== null)) {
      context.addIssue({ code: 'custom', message: 'Chunk 字段必须同时存在或同时为空。' });
      return;
    }
    if (hasChunk) {
      if (activity.chunkIndex! > activity.chunkCount!) {
        context.addIssue({
          code: 'custom',
          path: ['chunkIndex'],
          message: '当前 Chunk 超出总数。',
        });
      }
      if (activity.chunkEndMs! <= activity.chunkStartMs!) {
        context.addIssue({ code: 'custom', path: ['chunkEndMs'], message: 'Chunk 时间范围无效。' });
      }
    } else if (activity.networkAttempt !== null || activity.structureAttempt !== null) {
      context.addIssue({ code: 'custom', message: '尝试次数必须关联一个 Chunk。' });
    }
  });
export const AudioProcessingStatusSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('uploading'), progress: z.number().int().min(0).max(100) }),
  z.object({ kind: z.literal('waiting') }),
  z.object({
    kind: z.literal('transcribing'),
    progress: z.number().int().min(0).max(100),
    activity: AudioTranscriptionActivitySchema.nullable(),
  }),
  z.object({ kind: z.literal('analyzing'), progress: z.number().int().min(0).max(100) }),
  z.object({ kind: z.literal('ready') }),
  z.object({
    kind: z.literal('failed'),
    stage: AudioFailureStageSchema,
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
    details: AudioFailureDetailsSchema.nullable(),
  }),
]);
export const AudioFileSummarySchema = z.object({
  id: EntityIdSchema,
  sourceId: EntityIdSchema.nullable(),
  title: z.string(),
  durationMs: z.number().int().nonnegative().nullable(),
  createdAt: z.string().datetime(),
  sharedFrom: z.string().nullable(),
  hasTranscript: z.boolean(),
  status: AudioProcessingStatusSchema,
  runtimeMode: z.enum(['hybrid', 'object_storage', 'lightweight_local']).optional(),
  sourceState: z.enum(['available', 'cleaned', 'missing']).optional(),
  sourceRecoveryState: z.enum(['not_required', 'required', 'verifying']).optional(),
  sourceDeleteAfter: z.string().datetime().nullable().optional(),
  acousticEmotionReady: z.boolean().default(false),
});
export const AudioFileListResponseSchema = z.object({ items: z.array(AudioFileSummarySchema) });

export type AudioFailureStage = z.infer<typeof AudioFailureStageSchema>;
export type AudioFailureDiagnosticCategory = z.infer<typeof AudioFailureDiagnosticCategorySchema>;
export type AudioFailureIssue = z.infer<typeof AudioFailureIssueSchema>;
export type AudioFailureDetails = z.infer<typeof AudioFailureDetailsSchema>;
export type AudioTranscriptionStage = z.infer<typeof AudioTranscriptionStageSchema>;
export type AudioTranscriptionActivity = z.infer<typeof AudioTranscriptionActivitySchema>;
export type AudioProcessingStatus = z.infer<typeof AudioProcessingStatusSchema>;
export type AudioFileSummary = z.infer<typeof AudioFileSummarySchema>;
