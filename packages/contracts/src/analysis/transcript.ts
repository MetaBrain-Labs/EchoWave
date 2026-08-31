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
  segmentId: EntityIdSchema,
  text: z.string().trim().min(1),
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
  invalidSegments: z.array(AnalysisInvalidSegmentSchema),
  summarySections: z.array(AnalysisSummarySectionSchema),
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
export type AudioTranscriptConfirmationState = z.infer<
  typeof AudioTranscriptConfirmationStateSchema
>;
export type AudioTranscriptConfirmationRequest = z.infer<
  typeof AudioTranscriptConfirmationRequestSchema
>;
export type AudioTranscriptConfirmationResponse = z.infer<
  typeof AudioTranscriptConfirmationResponseSchema
>;
