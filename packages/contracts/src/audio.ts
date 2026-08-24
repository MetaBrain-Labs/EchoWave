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
  hasTranscript: z.boolean(),
  status: AudioProcessingStatusSchema,
});

export const AudioFileListResponseSchema = z.object({ items: z.array(AudioFileSummarySchema) });

export const AUDIO_TRANSCRIPTION_DIRECT_FORMATS = [
  'mp3',
  'wav',
  'm4a',
  'aac',
  'flac',
  'ogg',
  'webm',
] as const;
export const AUDIO_TRANSCRIPTION_DIRECT_MAX_BYTES = 200 * 1024 * 1024;

export const AudioTranscriptionPreprocessingSchema = z.enum(['ffmpeg', 'direct']);
export const AudioTranscriptionDirectFormatSchema = z.enum(AUDIO_TRANSCRIPTION_DIRECT_FORMATS);

/** 创建音频转写修订时选择的预处理方式。 */
export const AudioTranscriptionStartRequestSchema = z.object({
  preprocessing: AudioTranscriptionPreprocessingSchema,
});

/** 客户端渲染转写确认框所需的服务端能力快照。 */
export const AudioTranscriptionCapabilitiesResponseSchema = z.object({
  ffmpeg: z.object({ configured: z.boolean(), available: z.boolean() }),
  direct: z.object({
    maxBytes: z.literal(AUDIO_TRANSCRIPTION_DIRECT_MAX_BYTES),
    formats: z.array(AudioTranscriptionDirectFormatSchema).min(1),
  }),
});

/** 音频转写任务进入 PostgreSQL 队列后的稳定响应。 */
export const AudioTranscriptionStartResponseSchema = z.object({
  audioFileId: EntityIdSchema,
  revisionId: EntityIdSchema,
  status: z.literal('queued'),
});

export type AudioFailureStage = z.infer<typeof AudioFailureStageSchema>;
export type AudioProcessingStatus = z.infer<typeof AudioProcessingStatusSchema>;
export type AudioFileSummary = z.infer<typeof AudioFileSummarySchema>;
export type AudioTranscriptionPreprocessing = z.infer<typeof AudioTranscriptionPreprocessingSchema>;
export type AudioTranscriptionDirectFormat = z.infer<typeof AudioTranscriptionDirectFormatSchema>;
export type AudioTranscriptionStartRequest = z.infer<typeof AudioTranscriptionStartRequestSchema>;
export type AudioTranscriptionCapabilitiesResponse = z.infer<
  typeof AudioTranscriptionCapabilitiesResponseSchema
>;
export type AudioTranscriptionStartResponse = z.infer<typeof AudioTranscriptionStartResponseSchema>;
