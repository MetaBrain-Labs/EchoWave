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

/** 音频处理失败的稳定诊断分类，避免向客户端暴露 Provider 原始响应。 */
export const AudioFailureDiagnosticCategorySchema = z.enum([
  'invalid_json',
  'schema_validation',
  'semantic_validation',
  'provider',
  'timeout',
  'preprocessing',
  'internal',
]);

/** 单条可安全展示的音频失败校验问题。 */
export const AudioFailureIssueSchema = z.object({
  path: z.string().max(200),
  code: z.string().min(1).max(80),
  message: z.string().min(1).max(500),
});

/** 音频失败详情不包含音频、提示词或模型输出正文。 */
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
  'validating',
  'correcting',
  'splitting',
  'merging',
  'publishing',
]);

/** 转写进行中可安全提供给客户端的细粒度活动状态。 */
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

/** 音频从上传到分析发布的统一可观察状态。 */
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
export const AUDIO_TRANSCRIPTION_DIRECT_MAX_DURATION_MS = 45_000;

/** 服务端和客户端共同接受的 OpenRouter STT 模型白名单。 */
export const AUDIO_TRANSCRIPTION_MODELS = [
  'x-ai/grok-stt-1.0',
  'qwen/qwen3-asr-1.7b',
  'openai/whisper-large-v3',
  'openai/gpt-transcribe',
  'mistralai/voxtral-mini-transcribe',
] as const;
export const DEFAULT_AUDIO_TRANSCRIPTION_MODEL = 'x-ai/grok-stt-1.0' as const;
export const AudioTranscriptionModelSchema = z.enum(AUDIO_TRANSCRIPTION_MODELS);
export const AudioTranscriptionTimestampGranularitySchema = z.enum(['word', 'segment', 'chunk']);

/** 单个 STT 模型供确认框展示的稳定能力声明。 */
export const AudioTranscriptionModelCapabilitySchema = z.object({
  id: AudioTranscriptionModelSchema,
  displayName: z.string().min(1),
  description: z.string().min(1),
  diarization: z.boolean(),
  timestampGranularity: AudioTranscriptionTimestampGranularitySchema,
});

/** 静态模型目录避免运行时模型发现变化影响产品行为。 */
export const AUDIO_TRANSCRIPTION_MODEL_CAPABILITIES = [
  {
    id: 'x-ai/grok-stt-1.0',
    displayName: 'SpaceXAI: Grok STT 1.0',
    description: '词级时间戳，可选 Speaker 分离',
    diarization: true,
    timestampGranularity: 'word',
  },
  {
    id: 'qwen/qwen3-asr-1.7b',
    displayName: 'Qwen: Qwen3 ASR 1.7B',
    description: '中文及方言，词级或分段时间戳',
    diarization: false,
    timestampGranularity: 'word',
  },
  {
    id: 'openai/whisper-large-v3',
    displayName: 'OpenAI: Whisper Large V3',
    description: '多语言，词级或分段时间戳',
    diarization: false,
    timestampGranularity: 'word',
  },
  {
    id: 'openai/gpt-transcribe',
    displayName: 'OpenAI: GPT Transcribe',
    description: '高准确率、多语言提示支持',
    diarization: false,
    timestampGranularity: 'segment',
  },
  {
    id: 'mistralai/voxtral-mini-transcribe',
    displayName: 'Mistral: Voxtral Mini Transcribe',
    description: '标准文本转写',
    diarization: false,
    timestampGranularity: 'chunk',
  },
] as const satisfies readonly z.infer<typeof AudioTranscriptionModelCapabilitySchema>[];

export const AudioTranscriptionPreprocessingSchema = z.enum(['ffmpeg', 'direct']);
export const AudioTranscriptionDirectFormatSchema = z.enum(AUDIO_TRANSCRIPTION_DIRECT_FORMATS);

/** 创建音频转写修订时选择的预处理方式。 */
export const AudioTranscriptionStartRequestSchema = z.object({
  model: AudioTranscriptionModelSchema.optional(),
  preprocessing: AudioTranscriptionPreprocessingSchema,
});

/** 客户端渲染转写确认框所需的服务端能力快照。 */
export const AudioTranscriptionCapabilitiesResponseSchema = z.object({
  defaultModel: AudioTranscriptionModelSchema,
  models: z
    .array(AudioTranscriptionModelCapabilitySchema)
    .length(AUDIO_TRANSCRIPTION_MODELS.length),
  ffmpeg: z.object({ configured: z.boolean(), available: z.boolean() }),
  direct: z.object({
    maxBytes: z.literal(AUDIO_TRANSCRIPTION_DIRECT_MAX_BYTES),
    maxDurationMs: z.literal(AUDIO_TRANSCRIPTION_DIRECT_MAX_DURATION_MS),
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
export type AudioFailureDiagnosticCategory = z.infer<typeof AudioFailureDiagnosticCategorySchema>;
export type AudioFailureIssue = z.infer<typeof AudioFailureIssueSchema>;
export type AudioFailureDetails = z.infer<typeof AudioFailureDetailsSchema>;
export type AudioTranscriptionStage = z.infer<typeof AudioTranscriptionStageSchema>;
export type AudioTranscriptionActivity = z.infer<typeof AudioTranscriptionActivitySchema>;
export type AudioProcessingStatus = z.infer<typeof AudioProcessingStatusSchema>;
export type AudioFileSummary = z.infer<typeof AudioFileSummarySchema>;
export type AudioTranscriptionPreprocessing = z.infer<typeof AudioTranscriptionPreprocessingSchema>;
export type AudioTranscriptionModel = z.infer<typeof AudioTranscriptionModelSchema>;
export type AudioTranscriptionModelCapability = z.infer<
  typeof AudioTranscriptionModelCapabilitySchema
>;
export type AudioTranscriptionTimestampGranularity = z.infer<
  typeof AudioTranscriptionTimestampGranularitySchema
>;
export type AudioTranscriptionDirectFormat = z.infer<typeof AudioTranscriptionDirectFormatSchema>;
export type AudioTranscriptionStartRequest = z.infer<typeof AudioTranscriptionStartRequestSchema>;
export type AudioTranscriptionCapabilitiesResponse = z.infer<
  typeof AudioTranscriptionCapabilitiesResponseSchema
>;
export type AudioTranscriptionStartResponse = z.infer<typeof AudioTranscriptionStartResponseSchema>;
