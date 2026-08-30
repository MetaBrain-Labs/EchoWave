/**
 * 实时状态 SSE 网络契约。
 *
 * 定义数据源音频、分析任务和知识文档的快照与增量事件，供 API 与移动端共同校验。
 *
 * Responsibilities:
 * - 约束 SSE 首帧、资源更新、心跳和结构化错误。
 * - 保持事件只包含安全状态，不暴露模型或供应商原始内容。
 *
 * Notes:
 * - 实时事件不是持久恢复日志；重连必须以 snapshot 重新建立状态。
 */
import { z } from 'zod';

import { AudioBusinessAnalysisStateSchema, AudioPostAnalysisStateSchema } from './analysis.ts';
import { AudioFileSummarySchema } from './audio.ts';
import { EntityIdSchema } from './common.ts';
import { KnowledgeDocumentSchema } from './document.ts';

const StreamErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean(),
});

const StreamCommonSchema = z.object({
  cursor: z.string().regex(/^\d+$/),
  occurredAt: z.string().datetime(),
});

const HeartbeatSchema = StreamCommonSchema.extend({ type: z.literal('heartbeat') });
const ErrorSchema = StreamCommonSchema.extend({
  type: z.literal('error'),
  error: StreamErrorSchema,
});

export const DataSourceAudioStreamEventSchema = z.discriminatedUnion('type', [
  StreamCommonSchema.extend({
    type: z.literal('snapshot'),
    dataSourceId: EntityIdSchema,
    items: z.array(AudioFileSummarySchema),
  }),
  StreamCommonSchema.extend({
    type: z.literal('audio-file'),
    dataSourceId: EntityIdSchema,
    audioFileId: EntityIdSchema,
    item: AudioFileSummarySchema.nullable(),
    terminal: z.boolean(),
  }),
  StreamCommonSchema.extend({
    type: z.literal('refresh'),
    dataSourceId: EntityIdSchema,
  }),
  HeartbeatSchema,
  ErrorSchema,
]);

export const AudioBusinessAnalysisLiveStateSchema = AudioBusinessAnalysisStateSchema.omit({
  result: true,
});

const AudioAnalysisLiveStateSchema = z.object({
  emotion: AudioPostAnalysisStateSchema,
  role: AudioPostAnalysisStateSchema,
  business: AudioBusinessAnalysisLiveStateSchema,
});

export const AudioAnalysisStatusStreamEventSchema = z.discriminatedUnion('type', [
  StreamCommonSchema.extend({
    type: z.literal('snapshot'),
    audioFileId: EntityIdSchema,
    analysisRevisionId: EntityIdSchema,
    state: AudioAnalysisLiveStateSchema,
  }),
  StreamCommonSchema.extend({
    type: z.literal('analysis-status'),
    audioFileId: EntityIdSchema,
    analysisRevisionId: EntityIdSchema,
    state: AudioAnalysisLiveStateSchema,
    terminal: z.boolean(),
  }),
  HeartbeatSchema,
  ErrorSchema,
]);

export const KnowledgeDocumentStreamEventSchema = z.discriminatedUnion('type', [
  StreamCommonSchema.extend({
    type: z.literal('snapshot'),
    knowledgeBaseId: EntityIdSchema,
    items: z.array(KnowledgeDocumentSchema),
  }),
  StreamCommonSchema.extend({
    type: z.literal('document'),
    knowledgeBaseId: EntityIdSchema,
    item: KnowledgeDocumentSchema.nullable(),
    terminal: z.boolean(),
  }),
  HeartbeatSchema,
  ErrorSchema,
]);

export type DataSourceAudioStreamEvent = z.infer<typeof DataSourceAudioStreamEventSchema>;
export type AudioAnalysisStatusStreamEvent = z.infer<typeof AudioAnalysisStatusStreamEventSchema>;
export type KnowledgeDocumentStreamEvent = z.infer<typeof KnowledgeDocumentStreamEventSchema>;
