/**
 * 音频执行 PostgreSQL recorder。
 *
 * 把通用执行报告事件安全、串行地写入运行表和事件表，并旁路发布实时通知。
 *
 * Responsibilities:
 * - 记录运行、步骤、模型调用、工具调用和有界 reasoning 增量。
 * - 保证审计写入失败不改变原始 AI 工作流结果。
 *
 * Notes:
 * - 写队列在单次运行内保持事件顺序。
 */
import { randomUUID } from 'node:crypto';

import {
  redactAiDiagnosticText,
  type AiExecutionRecorder,
  type AiExecutionResult,
  type AiExecutionStart,
  type AiModelCallEvent,
  type AiModelCallSpan,
  type AiModelCallStart,
  type AiStepEvent,
  type AiToolCallEvent,
  type AiToolCallSpan,
  type AiToolCallStart,
} from '../../../ai-observability/executionReporter.ts';
import type { DatabasePool } from '../../../infrastructure/postgres.ts';
import type { LiveUpdateBroker } from '../../../infrastructure/liveUpdateBroker.ts';
import {
  MODEL_DISPLAY_NAMES,
  REASONING_BATCH_CHARACTERS,
  REASONING_FLUSH_MS,
  REASONING_LIMIT,
  TOOL_DISPLAY_NAMES,
  displayName,
  safeStepSummary,
  safeToolAudit,
  text,
  type RunContext,
  type StoredEventStatus,
  type StoredEventType,
} from './shared.ts';

export class PostgresAudioExecutionRecorder implements AiExecutionRecorder {
  private readonly id = randomUUID();
  private readonly startedAt = new Date();
  private readonly ready: Promise<boolean>;
  private writeQueue: Promise<void> = Promise.resolve();
  private sequence = 1;
  private finished = false;
  private readonly activeSteps = new Map<string, { operationId: string; startedAt: Date }[]>();

  constructor(
    private readonly pool: DatabasePool,
    private readonly runsTable: string,
    private readonly eventsTable: string,
    private readonly tenantId: string,
    private readonly input: AiExecutionStart,
    private readonly context: RunContext,
    resetPromise: Promise<void>,
    private readonly liveUpdates?: LiveUpdateBroker,
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
          this.notify();
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
    const occurredAt = new Date();
    if (event.status === 'started') {
      const operationId = randomUUID();
      const active = this.activeSteps.get(event.name) ?? [];
      active.push({ operationId, startedAt: occurredAt });
      this.activeSteps.set(event.name, active);
      this.enqueue(
        'step',
        operationId,
        event.name,
        event.status,
        undefined,
        {
          summary: safeStepSummary(event.metadata),
        },
        occurredAt,
      );
      return;
    }

    const active = this.activeSteps.get(event.name) ?? [];
    const matching = active.shift();
    if (active.length === 0) this.activeSteps.delete(event.name);
    else this.activeSteps.set(event.name, active);
    const operationId = matching?.operationId ?? randomUUID();
    const durationMs =
      matching !== undefined
        ? Math.max(0, occurredAt.getTime() - matching.startedAt.getTime())
        : event.durationMs;
    this.enqueue(
      'step',
      operationId,
      event.name,
      event.status,
      durationMs,
      {
        summary: safeStepSummary(event.metadata),
      },
      occurredAt,
    );
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
        this.notify();
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

  private notify(): void {
    this.liveUpdates?.publish({
      kind: 'audio-execution',
      audioFileId: this.context.audioFileId,
      analysisRevisionId: this.context.revisionId,
    });
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
      this.notify();
    } catch {
      await client.query('ROLLBACK');
      console.warn('[audio-execution-audit] failed to finish execution run');
    } finally {
      client.release();
    }
  }
}
