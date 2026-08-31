/**
 * 音频后置分析网络契约。
 *
 * 定义情绪、业务角色、后置分析状态和启动响应。
 *
 * Responsibilities:
 * - 校验逐片段情绪与录音级说话人角色结果。
 * - 描述后置分析任务生命周期。
 */
import { z } from 'zod';

import { EntityIdSchema } from '../common.ts';

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
export const SegmentRoleAnalysisSchema = z.object({
  kind: BusinessRoleKindSchema,
  label: z.string().trim().min(1).max(24),
  confidence: z.number().min(0).max(1),
  evidenceSegmentIds: z.array(EntityIdSchema).max(3),
  model: z.string().min(1),
});
export const AudioPostAnalysisStartResponseSchema = z.object({
  audioFileId: EntityIdSchema,
  revisionId: EntityIdSchema,
  jobId: EntityIdSchema,
  type: AudioPostAnalysisTypeSchema,
  status: z.literal('queued'),
});

export type AudioPostAnalysisType = z.infer<typeof AudioPostAnalysisTypeSchema>;
export type AudioPostAnalysisState = z.infer<typeof AudioPostAnalysisStateSchema>;
export type AudioPostAnalysisStartResponse = z.infer<typeof AudioPostAnalysisStartResponseSchema>;
export type AudioEmotionLabel = z.infer<typeof AudioEmotionLabelSchema>;
export type SegmentEmotionAnalysis = z.infer<typeof SegmentEmotionAnalysisSchema>;
export type BusinessRoleKind = z.infer<typeof BusinessRoleKindSchema>;
export type SegmentRoleAnalysis = z.infer<typeof SegmentRoleAnalysisSchema>;
