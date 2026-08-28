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
import { SourceLocatorSchema } from './document.ts';
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

/** 销售复盘标签的稳定分类。 */
export const BusinessAnalysisTagCategorySchema = z.enum([
  'strength',
  'improvement',
  'risk',
  'suggestion',
  'custom',
]);

/** 业务分析引用的知识块快照。 */
export const BusinessAnalysisCitationSchema = z.object({
  chunkId: EntityIdSchema,
  knowledgeBaseId: EntityIdSchema,
  documentId: EntityIdSchema,
  documentTitle: z.string().min(1),
  locator: SourceLocatorSchema,
});

/** 可关联多个、不连续转写片段的 AI 标签。 */
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

/** 当前分组的已发布销售复盘结果。 */
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

/** 当前分组业务分析的任务状态与上一成功结果。 */
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
  businessAnalysis: AudioBusinessAnalysisStateSchema.default({
    state: 'idle',
    groupId: null,
    jobId: null,
    model: null,
    progress: 0,
    confirmationVersion: null,
    settingsCurrent: true,
    knowledgeCurrent: true,
    error: null,
    result: null,
  }),
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
