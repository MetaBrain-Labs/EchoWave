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

/** 服务端和客户端共同接受的 DashScope 官方整文件转写模型。 */
export const AUDIO_TRANSCRIPTION_MODELS = ['qwen-audio-3.0-asr-flash-filetrans'] as const;
export const QWEN_AUDIO_FILETRANS_MODEL = 'qwen-audio-3.0-asr-flash-filetrans' as const;
export const DEFAULT_AUDIO_TRANSCRIPTION_MODEL = QWEN_AUDIO_FILETRANS_MODEL;
export const AudioTranscriptionModelSchema = z.enum(AUDIO_TRANSCRIPTION_MODELS);
export const AudioTranscriptionProviderSchema = z.literal('dashscope');
export const AudioTranscriptionSegmentationModeSchema = z.enum(['readable', 'speaker_turn']);
export const AudioTranscriptionSpeakerIdentityScopeSchema = z.enum(['recording', 'chunk', 'none']);
export const AudioTranscriptionTimestampGranularitySchema = z.enum(['word', 'segment', 'chunk']);
/** 模型目录声明的 Speaker 可用性，不代表单次响应一定返回 Speaker。 */
export const AudioTranscriptionDiarizationAvailabilitySchema = z.enum(['none', 'best_effort']);
/** 目录中的时间戳说明用于测试预期；实际粒度仍以单次响应为准。 */
export const AudioTranscriptionTimestampAvailabilitySchema = z.enum([
  'best_effort',
  'fallback_only',
]);
/** 静态价格快照支持 Token、音频时长和已包含的输出计费单位。 */
export const AudioTranscriptionPriceUnitSchema = z.enum([
  'million_tokens',
  'minute',
  'second',
  'included',
]);
export const AudioTranscriptionPriceSchema = z.object({
  amount: z.number().nonnegative(),
  currency: z.enum(['USD', 'CNY']),
  unit: AudioTranscriptionPriceUnitSchema,
});
export const AudioTranscriptionPricingSchema = z.object({
  asOf: z.string().date(),
  input: AudioTranscriptionPriceSchema,
  output: AudioTranscriptionPriceSchema,
});
/** 单次修订实际观察到的响应时间粒度；混合表示不同请求块返回不同粒度。 */
export const AudioTranscriptionResponseGranularitySchema = z.enum([
  'word',
  'segment',
  'chunk',
  'mixed',
]);

/** 单个 STT 模型供确认框展示的稳定能力声明。 */
export const AudioTranscriptionModelCapabilitySchema = z.object({
  id: AudioTranscriptionModelSchema,
  provider: AudioTranscriptionProviderSchema,
  displayName: z.string().min(1),
  description: z.string().min(1),
  diarization: z.boolean(),
  diarizationAvailability: AudioTranscriptionDiarizationAvailabilitySchema,
  emotionRecognition: z.boolean(),
  businessRoleRecognition: z.boolean(),
  notableCapabilities: z.array(z.string().min(1)).min(1),
  pricing: AudioTranscriptionPricingSchema,
  timestampAvailability: AudioTranscriptionTimestampAvailabilitySchema,
  timestampGranularity: AudioTranscriptionTimestampGranularitySchema,
  supportedSegmentationModes: z.array(AudioTranscriptionSegmentationModeSchema).min(1),
  available: z.boolean(),
  unavailableReason: z.string().min(1).nullable(),
});

/** 静态模型目录避免运行时模型发现变化影响产品行为。 */
export const AUDIO_TRANSCRIPTION_MODEL_CAPABILITIES = [
  {
    id: 'qwen-audio-3.0-asr-flash-filetrans',
    provider: 'dashscope',
    displayName: 'Qwen Audio 3.0 ASR Flash Filetrans',
    description: '阿里云北京地域整文件转写，支持中文说话人分离与句级时间戳',
    diarization: true,
    diarizationAvailability: 'best_effort',
    emotionRecognition: false,
    businessRoleRecognition: false,
    notableCapabilities: ['中文及方言', '录音级说话人分离', '句级时间戳'],
    pricing: {
      asOf: '2026-08-26',
      input: { amount: 0.00022, currency: 'CNY', unit: 'second' },
      output: { amount: 0, currency: 'CNY', unit: 'included' },
    },
    timestampAvailability: 'best_effort',
    timestampGranularity: 'segment',
    supportedSegmentationModes: ['speaker_turn'],
    available: false,
    unavailableReason: '需要完整配置 DashScope、北京地域 OSS 和 FFmpeg。',
  },
] as const satisfies readonly z.infer<typeof AudioTranscriptionModelCapabilitySchema>[];

export const AudioTranscriptionPreprocessingSchema = z.literal('whole_file');

/** 创建音频转写修订时选择的预处理方式。 */
export const AudioTranscriptionStartRequestSchema = z
  .object({
    model: AudioTranscriptionModelSchema.optional(),
    preprocessing: AudioTranscriptionPreprocessingSchema.default('whole_file'),
    segmentationMode: z.literal('speaker_turn').default('speaker_turn'),
  })
  .superRefine((request, context) => {
    if (request.model !== undefined && request.model !== QWEN_AUDIO_FILETRANS_MODEL) {
      context.addIssue({
        code: 'custom',
        path: ['model'],
        message: 'Only the DashScope Qwen Audio filetrans model is supported.',
      });
    }
  });

/** 客户端渲染转写确认框所需的服务端能力快照。 */
export const AudioTranscriptionCapabilitiesResponseSchema = z.object({
  defaultModel: AudioTranscriptionModelSchema,
  models: z
    .array(AudioTranscriptionModelCapabilitySchema)
    .length(AUDIO_TRANSCRIPTION_MODELS.length),
  ffmpeg: z.object({ configured: z.boolean(), available: z.boolean() }),
  transcriptionConfigured: z.boolean(),
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
export type AudioTranscriptionProvider = z.infer<typeof AudioTranscriptionProviderSchema>;
export type AudioTranscriptionSegmentationMode = z.infer<
  typeof AudioTranscriptionSegmentationModeSchema
>;
export type AudioTranscriptionSpeakerIdentityScope = z.infer<
  typeof AudioTranscriptionSpeakerIdentityScopeSchema
>;
export type AudioTranscriptionModelCapability = z.infer<
  typeof AudioTranscriptionModelCapabilitySchema
>;
export type AudioTranscriptionTimestampGranularity = z.infer<
  typeof AudioTranscriptionTimestampGranularitySchema
>;
export type AudioTranscriptionDiarizationAvailability = z.infer<
  typeof AudioTranscriptionDiarizationAvailabilitySchema
>;
export type AudioTranscriptionTimestampAvailability = z.infer<
  typeof AudioTranscriptionTimestampAvailabilitySchema
>;
export type AudioTranscriptionPriceUnit = z.infer<typeof AudioTranscriptionPriceUnitSchema>;
export type AudioTranscriptionPrice = z.infer<typeof AudioTranscriptionPriceSchema>;
export type AudioTranscriptionPricing = z.infer<typeof AudioTranscriptionPricingSchema>;
export type AudioTranscriptionResponseGranularity = z.infer<
  typeof AudioTranscriptionResponseGranularitySchema
>;
export type AudioTranscriptionStartRequest = z.input<typeof AudioTranscriptionStartRequestSchema>;
export type AudioTranscriptionCapabilitiesResponse = z.infer<
  typeof AudioTranscriptionCapabilitiesResponseSchema
>;
export type AudioTranscriptionStartResponse = z.infer<typeof AudioTranscriptionStartResponseSchema>;
