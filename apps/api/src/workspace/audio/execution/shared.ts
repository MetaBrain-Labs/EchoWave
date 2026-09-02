/**
 * 音频执行审计共享语义。
 *
 * 定义 recorder、查询和事件映射共同使用的安全字段、显示名称与运行上下文解析。
 *
 * Responsibilities:
 * - 限制允许持久化的审计字段。
 * - 从通用执行报告元数据恢复音频运行上下文。
 *
 * Notes:
 * - 不保存提示词、模型原始输出或未附着的推理正文。
 */
import type { AudioAiExecutionKind } from '@echowave/contracts';

import type { AiExecutionStart } from '../../../ai-observability/executionReporter.ts';

export const REASONING_LIMIT = 120_000;
export const REASONING_BATCH_CHARACTERS = 512;
export const REASONING_FLUSH_MS = 250;

export const AUDIO_KINDS = new Set<AudioAiExecutionKind>([
  'audio-transcription',
  'audio-emotion-analysis',
  'audio-role-recognition',
  'audio-speaker-review',
  'audio-business-analysis',
]);

export const MODEL_DISPLAY_NAMES: Record<string, string> = {
  'audio-file-transcription': '识别整段音频并生成带时间戳的说话人转写',
  'audio-emotion-analysis': '判断当前音频片段的情绪与置信度',
  'audio-role-recognition': '根据完整对话识别说话人的业务角色',
  'audio-speaker-review': '复核疑似说话人切换边界',
  'business-analysis-retrieval-planning': '规划业务分析所需的知识检索问题',
  'business-analysis-query-embedding': '将知识检索问题转换为语义向量',
  'business-analysis-generation': '结合转写与知识证据生成业务分析',
  'business-analysis-structure-repair': '修复业务分析的结构与引用',
};

export const TOOL_DISPLAY_NAMES: Record<string, string> = {
  search_knowledge: '检索分组关联知识库',
};

export type StoredEventType = 'run' | 'step' | 'model_call' | 'tool_call' | 'reasoning_delta';
export type StoredEventStatus = 'started' | 'completed' | 'failed' | 'interrupted';

export type RunContext = {
  audioFileId: string;
  revisionId: string;
  groupId: string | null;
  sourceJobId: string | null;
  phase: string | null;
  kind: AudioAiExecutionKind;
};

export type EventRow = Record<string, any> & {
  id: string;
  operation_id: string;
  sequence_no: number;
  stream_cursor: string | number;
  event_type: StoredEventType;
  name: string;
  status: StoredEventStatus;
  occurred_at: Date | string;
  duration_ms: number | string | null;
  details: Record<string, unknown>;
};

export function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function text(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

export function uuid(value: unknown): string | undefined {
  const candidate = text(value);
  return candidate &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)
    ? candidate
    : undefined;
}

export function integer(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const candidate = Number(value);
  return Number.isSafeInteger(candidate) && candidate >= 0 ? candidate : null;
}

export function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

export function safeStepSummary(value: unknown): Record<string, string | number | boolean | null> {
  const source = object(value);
  if (!source) return {};
  return Object.fromEntries(
    Object.entries(source)
      .filter(([, item]) => item === null || ['string', 'number', 'boolean'].includes(typeof item))
      .slice(0, 20)
      .map(([key, item]) => [
        key.slice(0, 80),
        typeof item === 'string' ? item.slice(0, 500) : item,
      ]),
  ) as Record<string, string | number | boolean | null>;
}

export function safeToolAudit(value: unknown) {
  const audit = object(object(value)?.audit);
  return {
    query: text(audit?.query)?.slice(0, 4_000) ?? null,
    knowledgeBases: Array.isArray(audit?.knowledgeBases) ? audit.knowledgeBases.slice(0, 50) : [],
    hitCount: integer(audit?.hitCount) ?? 0,
    hits: Array.isArray(audit?.hits) ? audit.hits.slice(0, 100) : [],
  };
}

export function runContext(input: AiExecutionStart): RunContext | undefined {
  if (!AUDIO_KINDS.has(input.kind as AudioAiExecutionKind)) return undefined;
  const metadata = input.metadata ?? {};
  const audio = object(metadata.audio);
  const revision = object(metadata.revision);
  const audioFileId = uuid(metadata.audioFileId) ?? uuid(audio?.audioFileId);
  const revisionId = uuid(metadata.revisionId) ?? uuid(revision?.revisionId);
  if (!audioFileId || !revisionId) return undefined;
  return {
    audioFileId,
    revisionId,
    groupId: uuid(metadata.groupId) ?? null,
    sourceJobId: uuid(metadata.jobId) ?? null,
    phase: text(metadata.phase)?.slice(0, 80) ?? null,
    kind: input.kind as AudioAiExecutionKind,
  };
}

export function displayName(
  operation: string,
  explicit: unknown,
  fallback: Record<string, string>,
): string {
  return text(explicit)?.slice(0, 240) ?? fallback[operation] ?? operation;
}
