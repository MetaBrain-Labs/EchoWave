/**
 * 音频转写模型网络契约。
 *
 * 定义固定 DashScope 模型目录、能力、价格快照和转写启动请求响应。
 *
 * Responsibilities:
 * - 保证 API 与移动端使用相同的模型能力声明。
 * - 校验预处理、分段和时间戳能力字段。
 */
import { z } from 'zod';

import { EntityIdSchema, SupportedLanguageSchema } from '../common.ts';

export const AUDIO_TRANSCRIPTION_MODELS = ['qwen-audio-3.0-asr-flash-filetrans'] as const;
export const QWEN_AUDIO_FILETRANS_MODEL = 'qwen-audio-3.0-asr-flash-filetrans' as const;
export const DEFAULT_AUDIO_TRANSCRIPTION_MODEL = QWEN_AUDIO_FILETRANS_MODEL;
export const AudioTranscriptionModelSchema = z.enum(AUDIO_TRANSCRIPTION_MODELS);
export const AudioTranscriptionProviderSchema = z.literal('dashscope');
export const AudioTranscriptionSegmentationModeSchema = z.enum(['readable', 'speaker_turn']);
export const AudioTranscriptionSpeakerIdentityScopeSchema = z.enum(['recording', 'chunk', 'none']);
export const AudioTranscriptionTimestampGranularitySchema = z.enum(['word', 'segment', 'chunk']);
export const AudioTranscriptionDiarizationAvailabilitySchema = z.enum(['none', 'best_effort']);
export const AudioTranscriptionTimestampAvailabilitySchema = z.enum([
  'best_effort',
  'fallback_only',
]);
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
export const AudioTranscriptionResponseGranularitySchema = z.enum([
  'word',
  'segment',
  'chunk',
  'mixed',
]);
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
export const AUDIO_TRANSCRIPTION_MODEL_CAPABILITIES = [
  {
    id: 'qwen-audio-3.0-asr-flash-filetrans',
    provider: 'dashscope',
    displayName: 'Qwen Audio 3.0 ASR Flash Filetrans',
    description: '阿里云北京地域整文件转写，支持中文说话人分离与词级时间戳',
    diarization: true,
    diarizationAvailability: 'best_effort',
    emotionRecognition: false,
    businessRoleRecognition: false,
    notableCapabilities: ['中文及方言', '录音级说话人分离', '词级时间戳'],
    pricing: {
      asOf: '2026-08-26',
      input: { amount: 0.00022, currency: 'CNY', unit: 'second' },
      output: { amount: 0, currency: 'CNY', unit: 'included' },
    },
    timestampAvailability: 'best_effort',
    timestampGranularity: 'word',
    supportedSegmentationModes: ['speaker_turn'],
    available: false,
    unavailableReason: '需要完整配置 DashScope、北京地域 OSS 和 FFmpeg。',
  },
] as const satisfies readonly z.infer<typeof AudioTranscriptionModelCapabilitySchema>[];
export const AudioTranscriptionPreprocessingSchema = z.enum(['silero_vad', 'whole_file']);
export const AudioTranscriptionStartRequestSchema = z
  .object({
    model: AudioTranscriptionModelSchema.optional(),
    preprocessing: AudioTranscriptionPreprocessingSchema.default('whole_file'),
    includeAcousticEmotion: z.boolean().default(true),
    segmentationMode: z.literal('speaker_turn').default('speaker_turn'),
    expectedSpeakerCount: z.number().int().min(2).max(100).optional(),
    language: SupportedLanguageSchema.default('zh-CN'),
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
export const AudioTranscriptionCapabilitiesResponseSchema = z.object({
  defaultModel: AudioTranscriptionModelSchema,
  models: z
    .array(AudioTranscriptionModelCapabilitySchema)
    .length(AUDIO_TRANSCRIPTION_MODELS.length),
  ffmpeg: z.object({ configured: z.boolean(), available: z.boolean() }),
  sileroVad: z.object({
    model: z.literal('silero-vad-v6.2.1'),
    available: z.boolean(),
    unavailableReason: z.string().min(1).nullable(),
  }),
  transcriptionConfigured: z.boolean(),
});
export const AudioTranscriptionStartResponseSchema = z.object({
  audioFileId: EntityIdSchema,
  revisionId: EntityIdSchema,
  status: z.literal('queued'),
});

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
