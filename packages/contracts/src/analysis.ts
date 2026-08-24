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

export const SegmentAiTagSchema = z.object({
  id: EntityIdSchema,
  title: z.string(),
  summary: z.string(),
  details: z.array(z.string()),
});

export const TranscriptSegmentSchema = z
  .object({
    id: EntityIdSchema,
    index: z.number().int().positive(),
    speakerKey: z.string(),
    speakerLabel: z.string(),
    businessRole: z.string(),
    emotion: z.string(),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    text: z.string(),
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
  scenes: z.array(AnalysisSceneSchema),
  invalidSegments: z.array(AnalysisInvalidSegmentSchema),
  summarySections: z.array(AnalysisSummarySectionSchema),
});

export type SegmentAiTag = z.infer<typeof SegmentAiTagSchema>;
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;
export type AnalysisScene = z.infer<typeof AnalysisSceneSchema>;
export type AnalysisInvalidSegment = z.infer<typeof AnalysisInvalidSegmentSchema>;
export type AnalysisSummarySection = z.infer<typeof AnalysisSummarySectionSchema>;
export type AudioAnalysisDetail = z.infer<typeof AudioAnalysisDetailSchema>;
