/**
 * 音频分析详情网络契约。
 *
 * 定义当前已发布分析版本的场景、转写、无效片段、摘要和 AI 标签结构。
 *
 * Responsibilities:
 * - 保证结果顺序、时间范围与嵌套关系可被移动端安全消费。
 *
 * Notes:
 * - 运行中版本不通过本契约暴露为已发布结果。
 */
import { z } from 'zod';

import { EntityIdSchema } from './common.ts';
import {
  AudioTranscriptionResponseGranularitySchema,
  AudioTranscriptionPreprocessingSchema,
  AudioTranscriptionSegmentationModeSchema,
  AudioTranscriptionSpeakerIdentityScopeSchema,
} from './audio.ts';

/** 已发布修订实际观察到的 Speaker 分离状态。 */
export const AudioTranscriptionDiarizationStatusSchema = z.enum([
  'observed',
  'not_returned',
  'not_supported',
]);

/** 已发布修订实际使用和观察到的 STT 能力。 */
export const AudioTranscriptionMetadataSchema = z.object({
  model: z.string().min(1),
  language: z.string().min(1),
  diarizationStatus: AudioTranscriptionDiarizationStatusSchema,
  responseGranularity: AudioTranscriptionResponseGranularitySchema.nullable(),
  segmentationMode: AudioTranscriptionSegmentationModeSchema.default('readable'),
  speakerIdentityScope: AudioTranscriptionSpeakerIdentityScopeSchema.default('none'),
  preprocessingMode: AudioTranscriptionPreprocessingSchema.default('whole_file'),
});

export const SegmentAiTagSchema = z.object({
  id: EntityIdSchema,
  title: z.string(),
  summary: z.string(),
  details: z.array(z.string()),
});

export const AudioPostAnalysisTypeSchema = z.enum(['emotion', 'role']);
export const AudioPostAnalysisStateSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('idle') }),
  z.object({
    state: z.enum(['queued', 'running']),
    jobId: EntityIdSchema,
    model: z.string().min(1),
    progress: z.number().int().min(0).max(100),
    confirmationVersion: z.number().int().positive(),
  }),
  z.object({
    state: z.literal('ready'),
    jobId: EntityIdSchema,
    model: z.string().min(1),
    completedAt: z.string().datetime(),
    confirmationVersion: z.number().int().positive(),
  }),
  z.object({
    state: z.literal('failed'),
    jobId: EntityIdSchema,
    model: z.string().min(1),
    code: z.string().min(1),
    message: z.string().min(1),
    retryable: z.boolean(),
    confirmationVersion: z.number().int().positive(),
  }),
]);

/** 当前 ASR 修订的人工确认状态。 */
export const AudioTranscriptConfirmationStateSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('pending'),
    currentVersion: z.literal(0),
    confirmedAt: z.null(),
  }),
  z.object({
    status: z.literal('confirmed'),
    currentVersion: z.number().int().positive(),
    confirmedAt: z.string().datetime(),
  }),
]);

/** 用户确认时提交的单个原始片段正文覆盖。 */
export const AudioTranscriptConfirmationSegmentInputSchema = z.object({
  segmentId: EntityIdSchema,
  text: z.string().trim().min(1),
});

/** 完整确认请求；服务端还会校验其片段集合与当前 Raw Transcript 完全一致。 */
export const AudioTranscriptConfirmationRequestSchema = z
  .object({
    analysisRevisionId: EntityIdSchema,
    baseVersion: z.number().int().nonnegative(),
    segments: z.array(AudioTranscriptConfirmationSegmentInputSchema),
  })
  .superRefine((input, context) => {
    const seen = new Set<string>();
    for (const [index, segment] of input.segments.entries()) {
      if (seen.has(segment.segmentId)) {
        context.addIssue({
          code: 'custom',
          message: 'segmentId must be unique.',
          path: ['segments', index, 'segmentId'],
        });
      }
      seen.add(segment.segmentId);
    }
  });

/** 成功发布的新 Confirmed Transcript 元数据。 */
export const AudioTranscriptConfirmationResponseSchema = z.object({
  audioFileId: EntityIdSchema,
  analysisRevisionId: EntityIdSchema,
  confirmationId: EntityIdSchema,
  version: z.number().int().positive(),
  confirmedAt: z.string().datetime(),
});

export const AudioEmotionLabelSchema = z.enum([
  'neutral',
  'happy',
  'sad',
  'angry',
  'anxious',
  'excited',
  'impatient',
  'frustrated',
  'sarcastic',
  'other',
  'unknown',
]);
export const AudioEmotionAttitudeSchema = z.enum([
  'cooperative',
  'engaged',
  'dismissive',
  'resistant',
  'hesitant',
  'assertive',
  'sarcastic',
  'neutral',
  'unknown',
]);
export const AudioEmotionArousalSchema = z.enum(['low', 'medium', 'high', 'unknown']);
export const AudioEmotionPaceSchema = z.enum(['slow', 'normal', 'fast', 'variable', 'unknown']);
export const AudioEmotionVolumeTrendSchema = z.enum([
  'low',
  'normal',
  'elevated',
  'rising',
  'falling',
  'variable',
  'unknown',
]);
export const AudioEmotionPitchVariationSchema = z.enum(['low', 'medium', 'high', 'unknown']);
export const AudioEmotionPausePatternSchema = z.enum([
  'few',
  'normal',
  'frequent',
  'long',
  'irregular',
  'unknown',
]);

/** Qwen 声学理解对单个转写片段发布的丰富情绪结果。 */
export const SegmentEmotionAnalysisSchema = z.object({
  label: AudioEmotionLabelSchema,
  confidence: z.number().min(0).max(1),
  attitude: AudioEmotionAttitudeSchema,
  arousal: AudioEmotionArousalSchema,
  pace: AudioEmotionPaceSchema,
  volumeTrend: AudioEmotionVolumeTrendSchema,
  pitchVariation: AudioEmotionPitchVariationSchema,
  pausePattern: AudioEmotionPausePatternSchema,
  vocalCues: z.array(z.string().trim().min(1).max(80)).max(5),
  model: z.string().min(1),
});

export const BusinessRoleKindSchema = z.enum(['sales', 'customer', 'other', 'unknown', 'custom']);

/** DeepSeek 对录音级说话人发布的业务角色结果。 */
export const SegmentRoleAnalysisSchema = z.object({
  kind: BusinessRoleKindSchema,
  label: z.string().trim().min(1).max(24),
  confidence: z.number().min(0).max(1),
  evidenceSegmentIds: z.array(EntityIdSchema).max(3),
  model: z.string().min(1),
});

export const TranscriptSegmentSchema = z
  .object({
    id: EntityIdSchema,
    index: z.number().int().positive(),
    speakerKey: z.string(),
    speakerLabel: z.string(),
    businessRole: z.string(),
    emotion: z.string(),
    roleAnalysis: SegmentRoleAnalysisSchema.nullable().default(null),
    emotionAnalysis: SegmentEmotionAnalysisSchema.nullable().default(null),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    rawText: z.string(),
    confirmedText: z.string().nullable(),
    aiTag: SegmentAiTagSchema.nullable(),
  })
  .refine((segment) => segment.endMs > segment.startMs, {
    message: 'endMs must be greater than startMs.',
  });

export const AnalysisSceneSchema = z.object({
  id: EntityIdSchema,
  index: z.number().int().positive(),
  title: z.string(),
  startMs: z.number().int().nonnegative(),
  segments: z.array(TranscriptSegmentSchema),
});

export const AnalysisInvalidSegmentSchema = z
  .object({
    id: EntityIdSchema,
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    reason: z.string(),
  })
  .refine((segment) => segment.endMs > segment.startMs, {
    message: 'endMs must be greater than startMs.',
  });

export const AnalysisSummarySectionSchema = z.object({
  id: EntityIdSchema,
  index: z.number().int().positive(),
  title: z.string(),
  body: z.string(),
});

export const AudioAnalysisDetailSchema = z.object({
  id: EntityIdSchema,
  audioFileId: EntityIdSchema,
  revision: z.number().int().positive(),
  title: z.string(),
  durationMs: z.number().int().nonnegative(),
  generatedAt: z.string().datetime(),
  transcription: AudioTranscriptionMetadataSchema,
  transcriptConfirmation: AudioTranscriptConfirmationStateSchema,
  postAnalysis: z
    .object({
      emotion: AudioPostAnalysisStateSchema,
      role: AudioPostAnalysisStateSchema,
    })
    .default({ emotion: { state: 'idle' }, role: { state: 'idle' } }),
  scenes: z.array(AnalysisSceneSchema),
  invalidSegments: z.array(AnalysisInvalidSegmentSchema),
  summarySections: z.array(AnalysisSummarySectionSchema),
});

export const AudioPostAnalysisStartResponseSchema = z.object({
  audioFileId: EntityIdSchema,
  revisionId: EntityIdSchema,
  jobId: EntityIdSchema,
  type: AudioPostAnalysisTypeSchema,
  status: z.literal('queued'),
});

export type SegmentAiTag = z.infer<typeof SegmentAiTagSchema>;
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;
export type AnalysisScene = z.infer<typeof AnalysisSceneSchema>;
export type AnalysisInvalidSegment = z.infer<typeof AnalysisInvalidSegmentSchema>;
export type AnalysisSummarySection = z.infer<typeof AnalysisSummarySectionSchema>;
export type AudioTranscriptionDiarizationStatus = z.infer<
  typeof AudioTranscriptionDiarizationStatusSchema
>;
export type AudioTranscriptionMetadata = z.infer<typeof AudioTranscriptionMetadataSchema>;
export type AudioAnalysisDetail = z.infer<typeof AudioAnalysisDetailSchema>;
export type AudioPostAnalysisType = z.infer<typeof AudioPostAnalysisTypeSchema>;
export type AudioPostAnalysisState = z.infer<typeof AudioPostAnalysisStateSchema>;
export type AudioPostAnalysisStartResponse = z.infer<typeof AudioPostAnalysisStartResponseSchema>;
export type AudioTranscriptConfirmationState = z.infer<
  typeof AudioTranscriptConfirmationStateSchema
>;
export type AudioTranscriptConfirmationRequest = z.infer<
  typeof AudioTranscriptConfirmationRequestSchema
>;
export type AudioTranscriptConfirmationResponse = z.infer<
  typeof AudioTranscriptConfirmationResponseSchema
>;
export type AudioEmotionLabel = z.infer<typeof AudioEmotionLabelSchema>;
export type SegmentEmotionAnalysis = z.infer<typeof SegmentEmotionAnalysisSchema>;
export type BusinessRoleKind = z.infer<typeof BusinessRoleKindSchema>;
export type SegmentRoleAnalysis = z.infer<typeof SegmentRoleAnalysisSchema>;
