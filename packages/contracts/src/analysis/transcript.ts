/**
 * 音频转写与分析详情网络契约。
 *
 * 定义已发布转写元数据、人工确认、场景、片段、摘要和完整分析详情。
 *
 * Responsibilities:
 * - 保证时间范围、确认版本和嵌套分析结果可被客户端安全消费。
 * - 组合后置分析与业务分析当前状态。
 */
import { z } from 'zod';

import {
  AudioTranscriptionPreprocessingSchema,
  AudioTranscriptionResponseGranularitySchema,
  AudioTranscriptionSegmentationModeSchema,
  AudioTranscriptionSpeakerIdentityScopeSchema,
} from '../audio.ts';
import { EntityIdSchema } from '../common.ts';
import { AudioBusinessAnalysisStateSchema } from './businessAnalysis.ts';
import {
  AudioPostAnalysisStateSchema,
  SegmentEmotionAnalysisSchema,
  SegmentRoleAnalysisSchema,
} from './postAnalysis.ts';

export const AudioTranscriptionDiarizationStatusSchema = z.enum([
  'observed',
  'not_returned',
  'not_supported',
]);
export const AudioTranscriptionMetadataSchema = z.object({
  model: z.string().min(1),
  language: z.string().min(1),
  diarizationStatus: AudioTranscriptionDiarizationStatusSchema,
  responseGranularity: AudioTranscriptionResponseGranularitySchema.nullable(),
  segmentationMode: AudioTranscriptionSegmentationModeSchema.default('readable'),
  speakerIdentityScope: AudioTranscriptionSpeakerIdentityScopeSchema.default('none'),
  preprocessingMode: AudioTranscriptionPreprocessingSchema.default('whole_file'),
  expectedSpeakerCount: z.number().int().min(2).max(100).nullable().default(null),
});
export const TranscriptWordSchema = z
  .object({
    index: z.number().int().nonnegative(),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    text: z.string().min(1),
    punctuation: z.string(),
  })
  .refine((word) => word.endMs > word.startMs, {
    message: 'endMs must be greater than startMs.',
  });
export const SpeakerReviewFindingSchema = z.object({
  id: EntityIdSchema,
  sourceSegmentId: EntityIdSchema.nullable(),
  splitAfterWordIndex: z.number().int().nonnegative().nullable(),
  kind: z.literal('speaker_turn_suspected'),
  severity: z.enum(['medium', 'high']),
  reasonCode: z.enum([
    'single_speaker_recording',
    'question_answer_transition',
    'long_single_speaker_segment',
    'long_internal_pause',
    'dialogue_pattern',
  ]),
  explanation: z.string().trim().min(1).max(200),
  source: z.enum(['rule', 'model']),
});
export const SpeakerReviewSchema = z.object({
  status: z.enum(['running', 'ready', 'partial']),
  model: z.string().min(1).nullable(),
  message: z.string().min(1).nullable(),
  resolvedAt: z.string().datetime().nullable().default(null),
  findings: z.array(SpeakerReviewFindingSchema),
});
export const SpeakerReviewResolutionResponseSchema = z.object({
  audioFileId: EntityIdSchema,
  resolvedCount: z.number().int().nonnegative(),
});
export const SegmentAiTagSchema = z.object({
  id: EntityIdSchema,
  title: z.string(),
  summary: z.string(),
  details: z.array(z.string()),
});
export const AudioTranscriptConfirmationStateSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pending'), currentVersion: z.literal(0), confirmedAt: z.null() }),
  z.object({
    status: z.literal('confirmed'),
    currentVersion: z.number().int().positive(),
    confirmedAt: z.string().datetime(),
  }),
]);
export const AudioTranscriptConfirmationSegmentInputSchema = z.object({
  sourceSegmentId: EntityIdSchema,
  parts: z
    .array(
      z.object({
        speakerKey: z.string().trim().min(1).max(120),
        startWordIndex: z.number().int().nonnegative(),
        endWordIndex: z.number().int().positive(),
        text: z.string().trim().min(1),
      }),
    )
    .min(1),
});
export const AudioTranscriptConfirmationRequestSchema = z
  .object({
    analysisRevisionId: EntityIdSchema,
    baseVersion: z.number().int().nonnegative(),
    segments: z.array(AudioTranscriptConfirmationSegmentInputSchema),
  })
  .superRefine((input, context) => {
    const seen = new Set<string>();
    for (const [index, segment] of input.segments.entries()) {
      if (seen.has(segment.sourceSegmentId)) {
        context.addIssue({
          code: 'custom',
          message: 'sourceSegmentId must be unique.',
          path: ['segments', index, 'sourceSegmentId'],
        });
      }
      seen.add(segment.sourceSegmentId);
    }
  });
export const AudioTranscriptConfirmationResponseSchema = z.object({
  audioFileId: EntityIdSchema,
  analysisRevisionId: EntityIdSchema,
  confirmationId: EntityIdSchema,
  version: z.number().int().positive(),
  confirmedAt: z.string().datetime(),
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
    sourceSegmentId: EntityIdSchema.nullable().default(null),
    startWordIndex: z.number().int().nonnegative().default(0),
    endWordIndex: z.number().int().positive().nullable().default(null),
    words: z.array(TranscriptWordSchema).default([]),
    reviewFindings: z.array(SpeakerReviewFindingSchema).default([]),
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
  speakerReview: SpeakerReviewSchema.default({
    status: 'partial',
    model: null,
    message: '历史转写未执行说话人复核。',
    resolvedAt: null,
    findings: [],
  }),
  transcriptConfirmation: AudioTranscriptConfirmationStateSchema,
  postAnalysis: z
    .object({ emotion: AudioPostAnalysisStateSchema, role: AudioPostAnalysisStateSchema })
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
  rawScenes: z.array(AnalysisSceneSchema).default([]),
  invalidSegments: z.array(AnalysisInvalidSegmentSchema),
  summarySections: z.array(AnalysisSummarySectionSchema),
});

export type SegmentAiTag = z.infer<typeof SegmentAiTagSchema>;
export type TranscriptWord = z.infer<typeof TranscriptWordSchema>;
export type SpeakerReviewFinding = z.infer<typeof SpeakerReviewFindingSchema>;
export type SpeakerReview = z.infer<typeof SpeakerReviewSchema>;
export type SpeakerReviewResolutionResponse = z.infer<typeof SpeakerReviewResolutionResponseSchema>;
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;
export type AnalysisScene = z.infer<typeof AnalysisSceneSchema>;
export type AnalysisInvalidSegment = z.infer<typeof AnalysisInvalidSegmentSchema>;
export type AnalysisSummarySection = z.infer<typeof AnalysisSummarySectionSchema>;
export type AudioTranscriptionDiarizationStatus = z.infer<
  typeof AudioTranscriptionDiarizationStatusSchema
>;
export type AudioTranscriptionMetadata = z.infer<typeof AudioTranscriptionMetadataSchema>;
export type AudioAnalysisDetail = z.infer<typeof AudioAnalysisDetailSchema>;
export type AudioTranscriptConfirmationState = z.infer<
  typeof AudioTranscriptConfirmationStateSchema
>;
export type AudioTranscriptConfirmationRequest = z.infer<
  typeof AudioTranscriptConfirmationRequestSchema
>;
export type AudioTranscriptConfirmationResponse = z.infer<
  typeof AudioTranscriptConfirmationResponseSchema
>;
