/**
 * 音频 AI 执行轨迹仓储。
 *
 * 将通用执行报告事件实时持久化为 PostgreSQL 审计轨迹，并为 REST 快照和 SSE 游标读取
 * 恢复当前分析修订的用户可见运行状态。
 *
 * Responsibilities:
 * - 旁路持久化四类音频 AI 运行、模型 reasoning 增量和工具事件。
 * - 按租户、当前修订、可选分组和流游标恢复执行轨迹。
 *
 * Notes:
 * - 任意审计写入失败都不得改变原始 AI 工作流结果。
 * - 提示词、模型原始终稿和工具原文不会进入产品审计。
 */
import { randomUUID } from 'node:crypto';

import {
  AudioAiExecutionStreamEventSchema,
  AudioAiExecutionTraceResponseSchema,
  type AudioAiExecutionKind,
  type AudioAiExecutionStreamEvent,
  type AudioAiExecutionTraceResponse,
} from '@echowave/contracts';

import {
  noOpAiExecutionRecorder,
  redactAiDiagnosticText,
  type AiExecutionRecorder,
  type AiExecutionReporter,
  type AiExecutionResult,
  type AiExecutionStart,
  type AiModelCallEvent,
  type AiModelCallSpan,
  type AiModelCallStart,
  type AiStepEvent,
  type AiToolCallEvent,
  type AiToolCallSpan,
  type AiToolCallStart,
} from '../../ai-observability/executionReporter.ts';
import { quoteIdentifier, type DatabasePool } from '../../infrastructure/postgres.ts';

const REASONING_LIMIT = 120_000;
const REASONING_BATCH_CHARACTERS = 512;
const REASONING_FLUSH_MS = 250;

const AUDIO_KINDS = new Set<AudioAiExecutionKind>([
  'audio-transcription',
  'audio-emotion-analysis',
  'audio-role-recognition',
  'audio-business-analysis',
]);

const MODEL_DISPLAY_NAMES: Record<string, string> = {
  'audio-file-transcription': '识别整段音频并生成带时间戳的说话人转写',
  'audio-emotion-analysis': '判断当前音频片段的情绪与置信度',
  'audio-role-recognition': '根据完整对话识别说话人的业务角色',
  'business-analysis-retrieval-planning': '规划业务分析所需的知识检索问题',
  'business-analysis-query-embedding': '将知识检索问题转换为语义向量',
  'business-analysis-generation': '结合转写与知识证据生成业务分析',
  'business-analysis-structure-repair': '修复业务分析的结构与引用',
};

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  search_knowledge: '检索分组关联知识库',
};

type StoredEventType = 'run' | 'step' | 'model_call' | 'tool_call' | 'reasoning_delta';
type StoredEventStatus = 'started' | 'completed' | 'failed' | 'interrupted';

type RunContext = {
  audioFileId: string;
  revisionId: string;
  groupId: string | null;
  sourceJobId: string | null;
  phase: string | null;
  kind: AudioAiExecutionKind;
};

type EventRow = Record<string, any> & {
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

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function uuid(value: unknown): string | undefined {
  const candidate = text(value);
  return candidate &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)
    ? candidate
    : undefined;
}

function integer(value: unknown): number | null {
  const candidate = Number(value);
  return Number.isSafeInteger(candidate) && candidate >= 0 ? candidate : null;
}

function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

function safeStepSummary(value: unknown): Record<string, string | number | boolean | null> {
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

function safeToolAudit(value: unknown) {
  const audit = object(object(value)?.audit);
  return {
    query: text(audit?.query)?.slice(0, 4_000) ?? null,
    knowledgeBases: Array.isArray(audit?.knowledgeBases) ? audit.knowledgeBases.slice(0, 50) : [],
    hitCount: integer(audit?.hitCount) ?? 0,
    hits: Array.isArray(audit?.hits) ? audit.hits.slice(0, 100) : [],
  };
}

function runContext(input: AiExecutionStart): RunContext | undefined {
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

function displayName(
  operation: string,
  explicit: unknown,
  fallback: Record<string, string>,
): string {
  return text(explicit)?.slice(0, 240) ?? fallback[operation] ?? operation;
}

/** 为音频 Worker 提供始终启用的实时审计报告器和查询能力。 */
export class AudioExecutionRepository {
  private readonly schema: string;
  private readonly resetPromise: Promise<void>;

  constructor(
    private readonly pool: DatabasePool,
    schema: string,
    private readonly tenantId: string,
  ) {
    this.schema = quoteIdentifier(schema);
    this.resetPromise = this.resetInterrupted().catch(() => {
      console.warn('[audio-execution-audit] failed to reset interrupted runs');
    });
  }

  private table(name: string): string {
    return `${this.schema}.${quoteIdentifier(name)}`;
  }

  /** 把上次进程退出时遗留的运行记录收敛为可解释的中断终态。 */
  private async resetInterrupted(): Promise<void> {
    await this.pool.query(
      `WITH interrupted AS (
         UPDATE ${this.table('ai_execution_runs')}
         SET status = 'interrupted', completed_at = now(),
             duration_ms = greatest(0, extract(epoch FROM (now() - started_at)) * 1000)::bigint,
             error_code = 'PROCESS_INTERRUPTED', error_message = '执行进程中断，任务可能已重新排队。',
             error_retryable = true
         WHERE tenant_id = $1 AND status = 'running'
         RETURNING tenant_id, id, name, completed_at, duration_ms
       )
       INSERT INTO ${this.table('ai_execution_events')}
         (tenant_id, execution_run_id, operation_id, sequence_no, event_type, name, status,
          occurred_at, duration_ms, details)
       SELECT interrupted.tenant_id, interrupted.id, interrupted.id,
              coalesce((SELECT max(event.sequence_no)
                        FROM ${this.table('ai_execution_events')} event
                        WHERE event.tenant_id = interrupted.tenant_id
                          AND event.execution_run_id = interrupted.id), 0) + 1,
              'run', interrupted.name, 'interrupted', interrupted.completed_at,
              interrupted.duration_ms, '{}'::jsonb
       FROM interrupted`,
      [this.tenantId],
    );
  }

  /** 创建只处理音频执行类型的报告器；其他类型继续由原诊断报告器负责。 */
  createReporter(): AiExecutionReporter {
    return {
      start: (input) => {
        const context = runContext(input);
        if (!context) return noOpAiExecutionRecorder;
        return new PostgresAudioExecutionRecorder(
          this.pool,
          this.table('ai_execution_runs'),
          this.table('ai_execution_events'),
          this.tenantId,
          input,
          context,
          this.resetPromise,
        );
      },
    };
  }

  /** 返回当前修订的非分组运行及指定分组业务运行。 */
  async getTrace(audioFileId: string, revisionId: string, groupId?: string) {
    const runs = await this.queryRuns(audioFileId, revisionId, groupId);
    const runIds = runs.rows.map((row) => row.id);
    const events =
      runIds.length === 0
        ? { rows: [] as EventRow[] }
        : await this.pool.query<EventRow>(
            `SELECT id, execution_run_id, operation_id, sequence_no, stream_cursor,
                    event_type, name, status, occurred_at, duration_ms, details
             FROM ${this.table('ai_execution_events')}
             WHERE tenant_id = $1 AND execution_run_id = ANY($2::uuid[])
             ORDER BY execution_run_id, sequence_no`,
            [this.tenantId, runIds],
          );

    return AudioAiExecutionTraceResponseSchema.parse({
      audioFileId,
      analysisRevisionId: revisionId,
      runs: runs.rows.map((run) => this.mapRun(run, events.rows)),
    });
  }

  /** 返回 SSE 首帧使用的完整快照和当前数据库游标。 */
  async getStreamSnapshot(audioFileId: string, revisionId: string, groupId?: string) {
    const [trace, cursor] = await Promise.all([
      this.getTrace(audioFileId, revisionId, groupId),
      this.pool.query<{ cursor: string }>(
        `SELECT coalesce(max(event.stream_cursor), 0)::text AS cursor
         FROM ${this.table('ai_execution_events')} event
         JOIN ${this.table('ai_execution_runs')} run
           ON run.tenant_id = event.tenant_id AND run.id = event.execution_run_id
         WHERE run.tenant_id = $1 AND run.audio_file_id = $2 AND run.analysis_revision_id = $3
           AND (run.group_id IS NULL OR ($4::uuid IS NOT NULL AND run.group_id = $4))`,
        [this.tenantId, audioFileId, revisionId, groupId ?? null],
      ),
    ]);
    return AudioAiExecutionStreamEventSchema.parse({
      type: 'snapshot',
      cursor: cursor.rows[0]?.cursor ?? '0',
      audioFileId,
      analysisRevisionId: revisionId,
      trace,
    });
  }

  /** 读取游标后的有界增量，供 SSE 连接持续推送。 */
  async getStreamEvents(
    audioFileId: string,
    revisionId: string,
    groupId: string | undefined,
    cursor: string,
  ): Promise<AudioAiExecutionStreamEvent[]> {
    const result = await this.pool.query<EventRow>(
      `SELECT event.id, event.execution_run_id, event.operation_id, event.sequence_no,
              event.stream_cursor, event.event_type, event.name, event.status,
              event.occurred_at, event.duration_ms, event.details
       FROM ${this.table('ai_execution_events')} event
       JOIN ${this.table('ai_execution_runs')} run
         ON run.tenant_id = event.tenant_id AND run.id = event.execution_run_id
       WHERE run.tenant_id = $1 AND run.audio_file_id = $2 AND run.analysis_revision_id = $3
         AND (run.group_id IS NULL OR ($4::uuid IS NOT NULL AND run.group_id = $4))
         AND event.stream_cursor > $5::bigint
       ORDER BY event.stream_cursor
       LIMIT 100`,
      [this.tenantId, audioFileId, revisionId, groupId ?? null, cursor],
    );
    if (result.rows.length === 0) return [];
    const trace = await this.getTrace(audioFileId, revisionId, groupId);
    return result.rows.map((event) => this.mapStreamEvent(audioFileId, revisionId, event, trace));
  }

  private queryRuns(audioFileId: string, revisionId: string, groupId?: string) {
    return this.pool.query(
      `SELECT id, kind, name, phase, status, group_id, source_job_id, started_at,
              completed_at, duration_ms, error_code, error_message, error_retryable
       FROM ${this.table('ai_execution_runs')}
       WHERE tenant_id = $1 AND audio_file_id = $2 AND analysis_revision_id = $3
         AND (group_id IS NULL OR ($4::uuid IS NOT NULL AND group_id = $4))
       ORDER BY started_at DESC, id DESC`,
      [this.tenantId, audioFileId, revisionId, groupId ?? null],
    );
  }

  private mapRun(run: Record<string, any>, allEvents: EventRow[]) {
    const events = allEvents.filter((event) => event.execution_run_id === run.id);
    const modelOperations = new Map<string, EventRow[]>();
    const toolOperations = new Map<string, EventRow[]>();
    for (const event of events) {
      if (event.event_type === 'model_call' || event.event_type === 'reasoning_delta') {
        const current = modelOperations.get(event.operation_id) ?? [];
        current.push(event);
        modelOperations.set(event.operation_id, current);
      } else if (event.event_type === 'tool_call') {
        const current = toolOperations.get(event.operation_id) ?? [];
        current.push(event);
        toolOperations.set(event.operation_id, current);
      }
    }
    return {
      id: run.id,
      kind: run.kind,
      name: run.name,
      phase: run.phase ?? null,
      status: run.status,
      groupId: run.group_id ?? null,
      sourceJobId: run.source_job_id ?? null,
      startedAt: iso(run.started_at),
      completedAt: run.completed_at ? iso(run.completed_at) : null,
      durationMs: integer(run.duration_ms),
      error: run.error_code
        ? {
            code: String(run.error_code),
            message: String(run.error_message ?? '执行失败。'),
            retryable: Boolean(run.error_retryable),
          }
        : null,
      steps: events
        .filter((event) => event.event_type === 'step')
        .map((event) => ({
          id: event.operation_id,
          sequence: Number(event.sequence_no),
          name: event.name,
          status: event.status,
          occurredAt: iso(event.occurred_at),
          durationMs: integer(event.duration_ms),
          summary: object(event.details)?.summary ?? {},
        })),
      modelCalls: [...modelOperations.values()]
        .map((operationEvents) => this.mapModelCall(operationEvents, run))
        .sort((left, right) => left.sequence - right.sequence),
      toolCalls: [...toolOperations.values()]
        .map((operationEvents) => this.mapToolCall(operationEvents, run))
        .sort((left, right) => left.sequence - right.sequence),
    };
  }

  private mapModelCall(events: EventRow[], run: Record<string, any>) {
    const modelEvents = events.filter((event) => event.event_type === 'model_call');
    const first = modelEvents[0] ?? events[0];
    if (!first) throw new Error('Model execution operation has no events.');
    const terminal = [...modelEvents].reverse().find((event) => event.status !== 'started');
    const details = {
      ...(object(first.details) ?? {}),
      ...(object(terminal?.details) ?? {}),
    };
    const reasoningEvents = events.filter((event) => event.event_type === 'reasoning_delta');
    return {
      id: first.operation_id,
      sequence: Number(first.sequence_no),
      operation: first.name,
      name: displayName(first.name, details.displayName, MODEL_DISPLAY_NAMES),
      provider: details.provider,
      model: details.model,
      status: terminal ? terminal.status : run.status === 'running' ? 'running' : 'failed',
      attempt: details.attempt,
      startedAt: iso(first.occurred_at),
      completedAt: terminal
        ? iso(terminal.occurred_at)
        : run.completed_at
          ? iso(run.completed_at)
          : null,
      durationMs: terminal
        ? integer(terminal.duration_ms)
        : run.completed_at
          ? Math.max(
              0,
              new Date(run.completed_at).getTime() - new Date(first.occurred_at).getTime(),
            )
          : null,
      inputTokens: integer(details.inputTokens),
      outputTokens: integer(details.outputTokens),
      estimatedCost: object(details.estimatedCost) ?? null,
      reasoningMode: text(details.reasoningMode) ?? 'unsupported',
      reasoningContent: reasoningEvents
        .map((event) => text(object(event.details)?.delta) ?? '')
        .join('')
        .slice(0, REASONING_LIMIT),
      reasoningTruncated:
        Boolean(details.reasoningTruncated) ||
        reasoningEvents.some((event) => Boolean(object(event.details)?.truncated)),
    };
  }

  private mapToolCall(events: EventRow[], run: Record<string, any>) {
    const first = events[0];
    if (!first) throw new Error('Tool execution operation has no events.');
    const terminal = [...events].reverse().find((event) => event.status !== 'started');
    const details = {
      ...(object(first.details) ?? {}),
      ...(object(terminal?.details) ?? {}),
    };
    return {
      id: first.operation_id,
      sequence: Number(first.sequence_no),
      operation: first.name,
      name: displayName(first.name, details.displayName, TOOL_DISPLAY_NAMES),
      status: terminal ? terminal.status : run.status === 'running' ? 'running' : 'failed',
      startedAt: iso(first.occurred_at),
      completedAt: terminal
        ? iso(terminal.occurred_at)
        : run.completed_at
          ? iso(run.completed_at)
          : null,
      durationMs: terminal
        ? integer(terminal.duration_ms)
        : run.completed_at
          ? Math.max(
              0,
              new Date(run.completed_at).getTime() - new Date(first.occurred_at).getTime(),
            )
          : null,
      query: text(details.query) ?? null,
      knowledgeBases: Array.isArray(details.knowledgeBases) ? details.knowledgeBases : [],
      hitCount: integer(details.hitCount) ?? 0,
      hits: Array.isArray(details.hits) ? details.hits : [],
    };
  }

  private mapStreamEvent(
    audioFileId: string,
    revisionId: string,
    event: EventRow,
    trace: AudioAiExecutionTraceResponse,
  ): AudioAiExecutionStreamEvent {
    const common = {
      cursor: String(event.stream_cursor),
      audioFileId,
      analysisRevisionId: revisionId,
      runId: event.execution_run_id,
      operationId: event.operation_id,
    };
    if (event.event_type === 'reasoning_delta') {
      return AudioAiExecutionStreamEventSchema.parse({
        ...common,
        type: 'reasoning-delta',
        delta: text(object(event.details)?.delta) ?? '',
        truncated: Boolean(object(event.details)?.truncated),
      });
    }
    const run = trace.runs.find((item) => item.id === event.execution_run_id);
    if (!run) throw new Error('Execution stream event references an unknown run.');
    if (event.event_type === 'run') {
      return AudioAiExecutionStreamEventSchema.parse({
        ...common,
        type: 'run-status',
        run:
          event.status === 'started'
            ? {
                ...run,
                status: 'running',
                completedAt: null,
                durationMs: null,
                error: null,
                steps: [],
                modelCalls: [],
                toolCalls: [],
              }
            : run,
      });
    }
    if (event.event_type === 'step') {
      const step = run.steps.find(
        (item) => item.id === event.operation_id && item.sequence === Number(event.sequence_no),
      );
      if (!step) throw new Error('Execution stream event references an unknown step.');
      return AudioAiExecutionStreamEventSchema.parse({ ...common, type: 'step', step });
    }
    if (event.event_type === 'model_call') {
      const modelCall = run.modelCalls.find((item) => item.id === event.operation_id);
      if (!modelCall) throw new Error('Execution stream event references an unknown model call.');
      const startedCall = {
        ...modelCall,
        status: 'running' as const,
        completedAt: null,
        durationMs: null,
        inputTokens: null,
        outputTokens: null,
        estimatedCost: null,
        reasoningContent: '',
        reasoningTruncated: false,
      };
      return AudioAiExecutionStreamEventSchema.parse({
        ...common,
        type: event.status === 'started' ? 'model-start' : 'model-finish',
        modelCall: event.status === 'started' ? startedCall : modelCall,
      });
    }
    const toolCall = run.toolCalls.find((item) => item.id === event.operation_id);
    if (!toolCall) throw new Error('Execution stream event references an unknown tool call.');
    const startedToolCall = {
      ...toolCall,
      status: 'running' as const,
      completedAt: null,
      durationMs: null,
      hitCount: 0,
      hits: [],
    };
    return AudioAiExecutionStreamEventSchema.parse({
      ...common,
      type: event.status === 'started' ? 'tool-start' : 'tool-finish',
      toolCall: event.status === 'started' ? startedToolCall : toolCall,
    });
  }
}

class PostgresAudioExecutionRecorder implements AiExecutionRecorder {
  private readonly id = randomUUID();
  private readonly startedAt = new Date();
  private readonly ready: Promise<boolean>;
  private writeQueue: Promise<void> = Promise.resolve();
  private sequence = 1;
  private finished = false;

  constructor(
    private readonly pool: DatabasePool,
    private readonly runsTable: string,
    private readonly eventsTable: string,
    private readonly tenantId: string,
    private readonly input: AiExecutionStart,
    private readonly context: RunContext,
    resetPromise: Promise<void>,
  ) {
    this.ready = resetPromise
      .then(async () => {
        const client = await this.pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(
            `INSERT INTO ${this.runsTable}
               (id, tenant_id, audio_file_id, analysis_revision_id, group_id, source_job_id,
                kind, name, phase, status, started_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'running', $10)`,
            [
              this.id,
              this.tenantId,
              this.context.audioFileId,
              this.context.revisionId,
              this.context.groupId,
              this.context.sourceJobId,
              this.context.kind,
              this.input.name.slice(0, 200),
              this.context.phase,
              this.startedAt,
            ],
          );
          await this.insertEvent(client, {
            operationId: this.id,
            sequence: 1,
            type: 'run',
            name: this.input.name,
            status: 'started',
            occurredAt: this.startedAt,
            durationMs: null,
            details: {},
          });
          await client.query('COMMIT');
          return true;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      })
      .catch(() => {
        console.warn('[audio-execution-audit] failed to start execution run');
        return false;
      });
  }

  recordMetadata(): void {}

  recordStep(event: AiStepEvent): void {
    this.enqueue('step', randomUUID(), event.name, event.status, event.durationMs, {
      summary: safeStepSummary(event.metadata),
    });
  }

  beginModelCall(event: AiModelCallStart): AiModelCallSpan {
    const operationId = event.operationId ?? randomUUID();
    const startedAt = new Date();
    let reasoningCharacters = 0;
    let reasoningBuffer = '';
    let reasoningTruncated = false;
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    let completed = false;
    const baseDetails = {
      displayName: displayName(event.name, event.displayName, MODEL_DISPLAY_NAMES),
      provider: event.provider.slice(0, 80),
      model: event.model.slice(0, 160),
      attempt: Math.max(1, event.attempt),
      reasoningMode: event.reasoningMode ?? 'unsupported',
    };
    this.enqueue(
      'model_call',
      operationId,
      event.name,
      'started',
      undefined,
      baseDetails,
      startedAt,
    );

    const flush = () => {
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = undefined;
      if (!reasoningBuffer) return;
      const delta = reasoningBuffer;
      reasoningBuffer = '';
      this.enqueue('reasoning_delta', operationId, event.name, 'started', undefined, {
        delta,
        truncated: reasoningTruncated,
      });
    };

    return {
      operationId,
      appendReasoning: (value) => {
        if (completed || !value || reasoningTruncated) return;
        const safe = redactAiDiagnosticText(value);
        let offset = 0;
        while (offset < safe.length && reasoningCharacters < REASONING_LIMIT) {
          const acceptedLength = Math.min(
            safe.length - offset,
            REASONING_LIMIT - reasoningCharacters,
            REASONING_BATCH_CHARACTERS - reasoningBuffer.length,
          );
          reasoningBuffer += safe.slice(offset, offset + acceptedLength);
          reasoningCharacters += acceptedLength;
          offset += acceptedLength;
          if (reasoningCharacters >= REASONING_LIMIT) reasoningTruncated = true;
          if (reasoningBuffer.length >= REASONING_BATCH_CHARACTERS || reasoningTruncated) flush();
        }
        if (offset < safe.length) reasoningTruncated = true;
        if (reasoningTruncated) flush();
        else if (reasoningBuffer && !flushTimer) flushTimer = setTimeout(flush, REASONING_FLUSH_MS);
      },
      finish: (result) => {
        if (completed) return;
        completed = true;
        flush();
        this.enqueue('model_call', operationId, event.name, result.status, result.durationMs, {
          ...baseDetails,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          estimatedCost: result.estimatedCost ?? null,
          reasoningTruncated,
        });
      },
    };
  }

  recordModelCall(event: AiModelCallEvent): void {
    const span = this.beginModelCall(event);
    span.finish(event);
  }

  beginToolCall(event: AiToolCallStart): AiToolCallSpan {
    const operationId = event.operationId ?? randomUUID();
    let completed = false;
    const baseDetails = {
      displayName: displayName(event.name, event.displayName, TOOL_DISPLAY_NAMES),
      ...safeToolAudit(event.summary),
    };
    this.enqueue('tool_call', operationId, event.name, 'started', undefined, baseDetails);
    return {
      operationId,
      finish: (result) => {
        if (completed) return;
        completed = true;
        this.enqueue('tool_call', operationId, event.name, result.status, result.durationMs, {
          ...baseDetails,
          ...safeToolAudit(result.summary),
        });
      },
    };
  }

  recordToolCall(event: AiToolCallEvent): void {
    const span = this.beginToolCall(event);
    span.finish(event);
  }

  recordContext(): void {}
  recordReasoning(): void {}
  recordOutput(): void {}

  private enqueue(
    type: StoredEventType,
    operationId: string,
    name: string,
    status: StoredEventStatus,
    durationMs: number | undefined,
    details: Record<string, unknown>,
    occurredAt = new Date(),
  ): void {
    this.sequence += 1;
    const sequence = this.sequence;
    this.writeQueue = this.writeQueue
      .then(async () => {
        if (!(await this.ready)) return;
        await this.insertEvent(this.pool, {
          operationId,
          sequence,
          type,
          name,
          status,
          occurredAt,
          durationMs: durationMs === undefined ? null : Math.max(0, Math.round(durationMs)),
          details,
        });
      })
      .catch(() => {
        console.warn('[audio-execution-audit] failed to persist live event');
      });
  }

  private async insertEvent(
    queryable: Pick<DatabasePool, 'query'>,
    event: {
      operationId: string;
      sequence: number;
      type: StoredEventType;
      name: string;
      status: StoredEventStatus;
      occurredAt: Date;
      durationMs: number | null;
      details: Record<string, unknown>;
    },
  ) {
    await queryable.query(
      `INSERT INTO ${this.eventsTable}
         (tenant_id, execution_run_id, operation_id, sequence_no, event_type, name, status,
          occurred_at, duration_ms, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
      [
        this.tenantId,
        this.id,
        event.operationId,
        event.sequence,
        event.type,
        event.name.slice(0, 120),
        event.status,
        event.occurredAt,
        event.durationMs,
        JSON.stringify(event.details),
      ],
    );
  }

  async finish(result: AiExecutionResult): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    if (!(await this.ready)) return;
    await this.writeQueue;
    const completedAt = new Date();
    const metadata = result.metadata ?? {};
    const code = result.status === 'failed' ? (text(metadata.code) ?? 'EXECUTION_FAILED') : null;
    const retryable = result.status === 'failed' ? Boolean(metadata.retryable) : null;
    const message =
      result.status === 'failed'
        ? result.error instanceof Error
          ? redactAiDiagnosticText(result.error.message).slice(0, 500)
          : 'AI 执行失败。'
        : null;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE ${this.runsTable}
         SET status = $3, completed_at = $4, duration_ms = $5,
             error_code = $6, error_message = $7, error_retryable = $8
         WHERE tenant_id = $1 AND id = $2`,
        [
          this.tenantId,
          this.id,
          result.status,
          completedAt,
          Math.max(0, completedAt.getTime() - this.startedAt.getTime()),
          code,
          message,
          retryable,
        ],
      );
      this.sequence += 1;
      await this.insertEvent(client, {
        operationId: this.id,
        sequence: this.sequence,
        type: 'run',
        name: this.input.name,
        status: result.status,
        occurredAt: completedAt,
        durationMs: Math.max(0, completedAt.getTime() - this.startedAt.getTime()),
        details: {},
      });
      await client.query('COMMIT');
    } catch {
      await client.query('ROLLBACK');
      console.warn('[audio-execution-audit] failed to finish execution run');
    } finally {
      client.release();
    }
  }
}
