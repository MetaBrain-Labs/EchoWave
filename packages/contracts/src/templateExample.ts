/**
 * 起步模板只读分析示例契约。
 *
 * 定义代码目录中的演示转写、证据和报告结构，不把示例伪装成真实音频或分析任务。
 *
 * Responsibilities:
 * - 校验模板示例的角色、时间片段、摘要、标签和改进建议。
 * - 保证证据引用指向响应中真实存在的转写片段。
 *
 * Notes:
 * - 示例不可播放，且不使用业务实体 UUID。
 */
import { z } from 'zod';

import { StarterTemplateKeySchema } from './group.ts';

export const TemplateExampleRoleSchema = z.object({
  id: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(40),
});

export const TemplateExampleTranscriptSegmentSchema = z
  .object({
    id: z.string().trim().min(1).max(40),
    roleId: z.string().trim().min(1).max(40),
    roleLabel: z.string().trim().min(1).max(40),
    emotion: z.string().trim().min(1).max(40),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    text: z.string().trim().min(1).max(2_000),
  })
  .refine((segment) => segment.endMs > segment.startMs, {
    message: 'endMs must be greater than startMs.',
    path: ['endMs'],
  });

export const TemplateExampleSummarySectionSchema = z.object({
  title: z.string().trim().min(1).max(80),
  body: z.string().trim().min(1).max(2_000),
});

export const TemplateExampleAnalysisTagSchema = z.object({
  kind: z.enum(['strength', 'improvement', 'risk', 'action']),
  title: z.string().trim().min(1).max(80),
  detail: z.string().trim().min(1).max(1_000),
  evidenceSegmentIds: z.array(z.string().trim().min(1).max(40)).min(1).max(12),
});

/** 完整的只读模板分析示例。 */
export const TemplateExampleSchema = z
  .object({
    templateKey: StarterTemplateKeySchema,
    exampleVersion: z.number().int().positive(),
    title: z.string().trim().min(1).max(120),
    scenario: z.string().trim().min(1).max(500),
    playbackAvailable: z.literal(false),
    roles: z.array(TemplateExampleRoleSchema).min(1).max(8),
    transcript: z.array(TemplateExampleTranscriptSegmentSchema).min(1).max(100),
    summarySections: z.array(TemplateExampleSummarySectionSchema).min(1).max(12),
    analysisTags: z.array(TemplateExampleAnalysisTagSchema).min(1).max(20),
    recommendations: z.array(z.string().trim().min(1).max(1_000)).min(1).max(20),
    limitations: z.array(z.string().trim().min(1).max(500)).min(1).max(10),
  })
  .superRefine((example, context) => {
    const roleIds = new Set(example.roles.map((role) => role.id));
    const segmentIds = new Set(example.transcript.map((segment) => segment.id));
    for (const [index, segment] of example.transcript.entries()) {
      if (!roleIds.has(segment.roleId)) {
        context.addIssue({
          code: 'custom',
          message: 'roleId must reference an existing role.',
          path: ['transcript', index, 'roleId'],
        });
      }
    }
    for (const [tagIndex, tag] of example.analysisTags.entries()) {
      for (const [evidenceIndex, segmentId] of tag.evidenceSegmentIds.entries()) {
        if (!segmentIds.has(segmentId)) {
          context.addIssue({
            code: 'custom',
            message: 'evidenceSegmentIds must reference an existing transcript segment.',
            path: ['analysisTags', tagIndex, 'evidenceSegmentIds', evidenceIndex],
          });
        }
      }
    }
  });

export type TemplateExample = z.infer<typeof TemplateExampleSchema>;
