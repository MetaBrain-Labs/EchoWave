/**
 * 音频 AI 执行轨迹仓储。
 *
 * 将通用执行报告事件收敛为不含提示词、模型原文和隐藏推理的 PostgreSQL 审计记录，
 * 并恢复当前分析修订的用户可见时间线。
 *
 * Responsibilities:
 * - 旁路持久化四类音频 AI 运行及其安全事件。
 * - 按租户、当前修订和可选分组恢复执行轨迹。
 *
 * Notes:
 * - 任意审计写入失败都不得改变原始 AI 工作流结果。
 */
import { randomUUID } from 'node:crypto';

import {
  AudioAiExecutionTraceResponseSchema,
  type AudioAiExecutionKind,
} from '@echowave/contracts';

import {
  noOpAiExecutionRecorder,
  type AiExecutionRecorder,
  type AiExecutionReporter,
  type AiExecutionResult,
  type AiExecutionStart,
  type AiModelCallEvent,
  type AiStepEvent,
  type AiToolCallEvent,
} from '../../ai-observability/executionReporter.ts';
import { quoteIdentifier, type DatabasePool } from '../../infrastructure/postgres.ts';

const AUDIO_KINDS = new Set<AudioAiExecutionKind>([
  'audio-transcription',
  'audio-emotion-analysis',
  'audio-role-recognition',
  'audio-business-analysis',
]);

type StoredEvent = {
  sequence: number;
  type: 'step' | 'model_call' | 'tool_call';
  name: string;
  status: 'started' | 'completed' | 'failed';
  occurredAt: Date;
  durationMs: number | null;
  details: Record<string, unknown>;
};

type RunContext = {
  audioFileId: string;
  revisionId: string;
  groupId: string | null;
  sourceJobId: string | null;
  phase: string | null;
  kind: AudioAiExecutionKind;
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

/** 为音频 Worker 提供始终启用的安全审计报告器和查询能力。 */
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
      `UPDATE ${this.table('ai_execution_runs')}
       SET status = 'interrupted', completed_at = now(),
           duration_ms = greatest(0, extract(epoch FROM (now() - started_at)) * 1000)::bigint,
           error_code = 'PROCESS_INTERRUPTED', error_message = '执行进程中断，任务可能已重新排队。',
           error_retryable = true
       WHERE tenant_id = $1 AND status = 'running'`,
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
    const runs = await this.pool.query(
      `SELECT id, kind, name, phase, status, group_id, source_job_id, started_at,
              completed_at, duration_ms, error_code, error_message, error_retryable
       FROM ${this.table('ai_execution_runs')}
       WHERE tenant_id = $1 AND audio_file_id = $2 AND analysis_revision_id = $3
         AND (group_id IS NULL OR ($4::uuid IS NOT NULL AND group_id = $4))
       ORDER BY started_at DESC, id DESC`,
      [this.tenantId, audioFileId, revisionId, groupId ?? null],
    );
    const runIds = runs.rows.map((row) => row.id);
    const events =
      runIds.length === 0
        ? { rows: [] as Record<string, any>[] }
        : await this.pool.query(
            `SELECT execution_run_id, sequence_no, event_type, name, status, occurred_at,
                    duration_ms, details
             FROM ${this.table('ai_execution_events')}
             WHERE tenant_id = $1 AND execution_run_id = ANY($2::uuid[])
             ORDER BY execution_run_id, sequence_no`,
            [this.tenantId, runIds],
          );

    return AudioAiExecutionTraceResponseSchema.parse({
      audioFileId,
      analysisRevisionId: revisionId,
      runs: runs.rows.map((run) => {
        const runEvents = events.rows.filter((event) => event.execution_run_id === run.id);
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
          steps: runEvents
            .filter((event) => event.event_type === 'step')
            .map((event) => ({
              sequence: Number(event.sequence_no),
              name: event.name,
              status: event.status,
              occurredAt: iso(event.occurred_at),
              durationMs: integer(event.duration_ms),
              summary: object(event.details)?.summary ?? {},
            })),
          modelCalls: runEvents
            .filter((event) => event.event_type === 'model_call')
            .map((event) => {
              const details = object(event.details) ?? {};
              return {
                sequence: Number(event.sequence_no),
                name: event.name,
                provider: details.provider,
                model: details.model,
                status: event.status,
                attempt: details.attempt,
                occurredAt: iso(event.occurred_at),
                durationMs: integer(event.duration_ms) ?? 0,
                inputTokens: integer(details.inputTokens),
                outputTokens: integer(details.outputTokens),
                estimatedCost: object(details.estimatedCost) ?? null,
              };
            }),
          toolCalls: runEvents
            .filter((event) => event.event_type === 'tool_call')
            .map((event) => {
              const details = object(event.details) ?? {};
              return {
                sequence: Number(event.sequence_no),
                name: event.name,
                status: event.status,
                occurredAt: iso(event.occurred_at),
                durationMs: integer(event.duration_ms),
                query: text(details.query) ?? null,
                knowledgeBases: Array.isArray(details.knowledgeBases) ? details.knowledgeBases : [],
                hitCount: integer(details.hitCount) ?? 0,
                hits: Array.isArray(details.hits) ? details.hits : [],
              };
            }),
        };
      }),
    });
  }
}

class PostgresAudioExecutionRecorder implements AiExecutionRecorder {
  private readonly id = randomUUID();
  private readonly startedAt = new Date();
  private readonly events: StoredEvent[] = [];
  private readonly ready: Promise<boolean>;
  private sequence = 0;
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
        await this.pool.query(
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
        return true;
      })
      .catch(() => {
        console.warn('[audio-execution-audit] failed to start execution run');
        return false;
      });
  }

  recordMetadata(): void {}

  recordStep(event: AiStepEvent): void {
    this.push('step', event.name, event.status, event.durationMs, {
      summary: safeStepSummary(event.metadata),
    });
  }

  recordModelCall(event: AiModelCallEvent): void {
    this.push('model_call', event.name, event.status, event.durationMs, {
      provider: event.provider.slice(0, 80),
      model: event.model.slice(0, 160),
      attempt: Math.max(1, event.attempt),
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      estimatedCost: event.estimatedCost ?? null,
    });
  }

  recordToolCall(event: AiToolCallEvent): void {
    const audit = object(event.summary?.audit);
    this.push('tool_call', event.name, event.status, event.durationMs, {
      query: text(audit?.query)?.slice(0, 4_000) ?? null,
      knowledgeBases: Array.isArray(audit?.knowledgeBases) ? audit.knowledgeBases.slice(0, 50) : [],
      hitCount: integer(audit?.hitCount) ?? 0,
      hits: Array.isArray(audit?.hits) ? audit.hits.slice(0, 100) : [],
    });
  }

  recordContext(): void {}
  recordReasoning(): void {}
  recordOutput(): void {}

  private push(
    type: StoredEvent['type'],
    name: string,
    status: StoredEvent['status'],
    durationMs: number | undefined,
    details: Record<string, unknown>,
  ): void {
    this.sequence += 1;
    this.events.push({
      sequence: this.sequence,
      type,
      name: name.slice(0, 120),
      status,
      occurredAt: new Date(),
      durationMs: durationMs === undefined ? null : Math.max(0, Math.round(durationMs)),
      details,
    });
  }

  async finish(result: AiExecutionResult): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    if (!(await this.ready)) return;
    const completedAt = new Date();
    const metadata = result.metadata ?? {};
    const code = result.status === 'failed' ? (text(metadata.code) ?? 'EXECUTION_FAILED') : null;
    const retryable = result.status === 'failed' ? Boolean(metadata.retryable) : null;
    const message =
      result.status === 'failed'
        ? result.error instanceof Error
          ? result.error.message.slice(0, 500)
          : 'AI 执行失败。'
        : null;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const event of this.events) {
        await client.query(
          `INSERT INTO ${this.eventsTable}
             (tenant_id, execution_run_id, sequence_no, event_type, name, status,
              occurred_at, duration_ms, details)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
          [
            this.tenantId,
            this.id,
            event.sequence,
            event.type,
            event.name,
            event.status,
            event.occurredAt,
            event.durationMs,
            JSON.stringify(event.details),
          ],
        );
      }
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
      await client.query('COMMIT');
    } catch {
      await client.query('ROLLBACK');
      console.warn('[audio-execution-audit] failed to finish execution run');
    } finally {
      client.release();
    }
  }
}
