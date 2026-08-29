/**
 * 音频 AI 执行轨迹网络契约。
 *
 * 定义模型、步骤和知识检索的安全审计视图，明确排除提示词、模型原文与隐藏推理。
 *
 * Responsibilities:
 * - 为 API 与移动端提供当前分析修订的稳定运行轨迹结构。
 * - 限制用户可见文本长度和知识引用范围。
 *
 * Notes:
 * - 本契约不是本地 Markdown 诊断报告的远程读取接口。
 */
import { z } from 'zod';

import { EntityIdSchema } from './common.ts';
import { SourceLocatorSchema } from './document.ts';

export const AudioAiExecutionKindSchema = z.enum([
  'audio-transcription',
  'audio-emotion-analysis',
  'audio-role-recognition',
  'audio-business-analysis',
]);

export const AudioAiExecutionStatusSchema = z.enum([
  'running',
  'completed',
  'failed',
  'interrupted',
]);

export const AudioAiExecutionModelCallSchema = z.object({
  sequence: z.number().int().positive(),
  name: z.string().min(1).max(120),
  provider: z.string().min(1).max(80),
  model: z.string().min(1).max(160),
  status: z.enum(['completed', 'failed']),
  attempt: z.number().int().positive(),
  occurredAt: z.string().datetime(),
  durationMs: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  estimatedCost: z
    .object({ amount: z.number().nonnegative(), currency: z.enum(['CNY', 'USD']) })
    .nullable(),
});

export const AudioAiExecutionStepSchema = z.object({
  sequence: z.number().int().positive(),
  name: z.string().min(1).max(120),
  status: z.enum(['started', 'completed', 'failed']),
  occurredAt: z.string().datetime(),
  durationMs: z.number().int().nonnegative().nullable(),
  summary: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
});

export const AudioAiKnowledgeBaseSnapshotSchema = z.object({
  id: EntityIdSchema,
  name: z.string().min(1).max(120),
});

export const AudioAiRetrievalHitSchema = z.object({
  chunkId: EntityIdSchema,
  knowledgeBaseId: EntityIdSchema,
  documentId: EntityIdSchema,
  documentTitle: z.string().min(1).max(500),
  locator: SourceLocatorSchema,
});

export const AudioAiExecutionToolCallSchema = z.object({
  sequence: z.number().int().positive(),
  name: z.string().min(1).max(120),
  status: z.enum(['completed', 'failed']),
  occurredAt: z.string().datetime(),
  durationMs: z.number().int().nonnegative().nullable(),
  query: z.string().max(4_000).nullable(),
  knowledgeBases: z.array(AudioAiKnowledgeBaseSnapshotSchema).max(50),
  hitCount: z.number().int().nonnegative(),
  hits: z.array(AudioAiRetrievalHitSchema).max(100),
});

export const AudioAiExecutionRunSchema = z.object({
  id: EntityIdSchema,
  kind: AudioAiExecutionKindSchema,
  name: z.string().min(1).max(200),
  phase: z.string().max(80).nullable(),
  status: AudioAiExecutionStatusSchema,
  groupId: EntityIdSchema.nullable(),
  sourceJobId: EntityIdSchema.nullable(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  error: z
    .object({ code: z.string().min(1), message: z.string().min(1), retryable: z.boolean() })
    .nullable(),
  steps: z.array(AudioAiExecutionStepSchema),
  modelCalls: z.array(AudioAiExecutionModelCallSchema),
  toolCalls: z.array(AudioAiExecutionToolCallSchema),
});

export const AudioAiExecutionTraceResponseSchema = z.object({
  audioFileId: EntityIdSchema,
  analysisRevisionId: EntityIdSchema,
  runs: z.array(AudioAiExecutionRunSchema),
});

export type AudioAiExecutionKind = z.infer<typeof AudioAiExecutionKindSchema>;
export type AudioAiExecutionStatus = z.infer<typeof AudioAiExecutionStatusSchema>;
export type AudioAiExecutionRun = z.infer<typeof AudioAiExecutionRunSchema>;
export type AudioAiExecutionTraceResponse = z.infer<typeof AudioAiExecutionTraceResponseSchema>;
