/**
 * 音频文件网络契约。
 *
 * 定义音频元数据和统一处理状态，使分组与数据源页面共享同一权威生命周期。
 *
 * Responsibilities:
 * - 校验音频摘要、时长和处理失败信息。
 *
 * Notes:
 * - 状态文案由客户端本地化，服务端只返回结构化事实。
 */
import { z } from 'zod';

import { EntityIdSchema } from './common.ts';

export const AudioFailureStageSchema = z.enum(['upload', 'transcription', 'analysis']);

/** 音频从上传到分析发布的统一可观察状态。 */
export const AudioProcessingStatusSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('uploading'), progress: z.number().int().min(0).max(100) }),
  z.object({ kind: z.literal('waiting') }),
  z.object({ kind: z.literal('transcribing'), progress: z.number().int().min(0).max(100) }),
  z.object({ kind: z.literal('analyzing'), progress: z.number().int().min(0).max(100) }),
  z.object({ kind: z.literal('ready') }),
  z.object({
    kind: z.literal('failed'),
    stage: AudioFailureStageSchema,
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
  }),
]);

/** 分组和数据源列表共用的音频摘要。 */
export const AudioFileSummarySchema = z.object({
  id: EntityIdSchema,
  sourceId: EntityIdSchema.nullable(),
  title: z.string(),
  durationMs: z.number().int().nonnegative().nullable(),
  createdAt: z.string().datetime(),
  sharedFrom: z.string().nullable(),
  status: AudioProcessingStatusSchema,
});

export const AudioFileListResponseSchema = z.object({ items: z.array(AudioFileSummarySchema) });

export type AudioFailureStage = z.infer<typeof AudioFailureStageSchema>;
export type AudioProcessingStatus = z.infer<typeof AudioProcessingStatusSchema>;
export type AudioFileSummary = z.infer<typeof AudioFileSummarySchema>;
