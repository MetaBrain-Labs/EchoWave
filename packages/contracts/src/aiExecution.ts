/**
 * 音频 AI 执行轨迹网络契约。
 *
 * 定义模型、步骤、知识检索和实时 reasoning 的审计视图，明确排除提示词与模型原始终稿。
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
  'audio-speaker-review',
  'audio-business-analysis',
]);

export const AudioAiExecutionStatusSchema = z.enum([
  'running',
  'completed',
  'failed',
  'interrupted',
]);

export const AudioAiExecutionModelCallSchema = z.object({
  id: EntityIdSchema,
  sequence: z.number().int().positive(),
  operation: z.string().min(1).max(120),
  name: z.string().min(1).max(240),
  provider: z.string().min(1).max(80),
  model: z.string().min(1).max(160),
  status: z.enum(['running', 'completed', 'failed']),
  attempt: z.number().int().positive(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  reasoningMode: z.enum(['streaming', 'disabled', 'unsupported']),
  reasoningContent: z.string().max(120_000),
  reasoningTruncated: z.boolean(),
  estimatedCost: z
    .object({ amount: z.number().nonnegative(), currency: z.enum(['CNY', 'USD']) })
    .nullable(),
});

export const AudioAiExecutionStepSchema = z
  .object({
    id: EntityIdSchema,
    sequence: z.number().int().positive(),
    name: z.string().min(1).max(120),
    status: z.enum(['started', 'completed', 'failed']),
    occurredAt: z.string().datetime(),
    durationMs: z.number().int().nonnegative().nullable(),
    summary: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  })
  .superRefine((step, context) => {
    if (step.status === 'started' && step.durationMs !== null) {
      context.addIssue({
        code: 'custom',
        path: ['durationMs'],
        message: 'Running steps must not have a final duration.',
      });
    }
    if (step.status !== 'started' && step.durationMs === null) {
      context.addIssue({
        code: 'custom',
        path: ['durationMs'],
        message: 'Terminal steps must have a final duration.',
      });
    }
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
  id: EntityIdSchema,
  sequence: z.number().int().positive(),
  operation: z.string().min(1).max(120),
  name: z.string().min(1).max(240),
  status: z.enum(['running', 'completed', 'failed']),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
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

const AudioAiExecutionStreamBaseSchema = z.object({
  cursor: z.string().regex(/^\d+$/),
  audioFileId: EntityIdSchema,
  analysisRevisionId: EntityIdSchema,
});

export const AudioAiExecutionStreamEventSchema = z.discriminatedUnion('type', [
  AudioAiExecutionStreamBaseSchema.extend({
    type: z.literal('snapshot'),
    trace: AudioAiExecutionTraceResponseSchema,
  }),
  AudioAiExecutionStreamBaseSchema.extend({
    type: z.literal('run-status'),
    runId: EntityIdSchema,
    operationId: EntityIdSchema,
    run: AudioAiExecutionRunSchema,
  }),
  AudioAiExecutionStreamBaseSchema.extend({
    type: z.literal('step'),
    runId: EntityIdSchema,
    operationId: EntityIdSchema,
    step: AudioAiExecutionStepSchema,
  }),
  AudioAiExecutionStreamBaseSchema.extend({
    type: z.enum(['model-start', 'model-finish']),
    runId: EntityIdSchema,
    operationId: EntityIdSchema,
    modelCall: AudioAiExecutionModelCallSchema,
  }),
  AudioAiExecutionStreamBaseSchema.extend({
    type: z.enum(['tool-start', 'tool-finish']),
    runId: EntityIdSchema,
    operationId: EntityIdSchema,
    toolCall: AudioAiExecutionToolCallSchema,
  }),
  AudioAiExecutionStreamBaseSchema.extend({
    type: z.literal('reasoning-delta'),
    runId: EntityIdSchema,
    operationId: EntityIdSchema,
    delta: z.string().max(2_048),
    truncated: z.boolean(),
  }),
  AudioAiExecutionStreamBaseSchema.extend({
    type: z.literal('heartbeat'),
    occurredAt: z.string().datetime(),
  }),
  AudioAiExecutionStreamBaseSchema.extend({
    type: z.literal('error'),
    error: z.object({
      code: z.string().min(1).max(120),
      message: z.string().min(1).max(500),
      retryable: z.boolean(),
    }),
  }),
]);

export type AudioAiExecutionKind = z.infer<typeof AudioAiExecutionKindSchema>;
export type AudioAiExecutionStatus = z.infer<typeof AudioAiExecutionStatusSchema>;
export type AudioAiExecutionRun = z.infer<typeof AudioAiExecutionRunSchema>;
export type AudioAiExecutionTraceResponse = z.infer<typeof AudioAiExecutionTraceResponseSchema>;
export type AudioAiExecutionStreamEvent = z.infer<typeof AudioAiExecutionStreamEventSchema>;
