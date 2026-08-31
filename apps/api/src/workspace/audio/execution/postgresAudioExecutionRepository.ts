/**
 * 音频执行 PostgreSQL Repository。
 *
 * 管理中断运行收敛、审计报告器创建以及轨迹和 SSE 游标查询。
 *
 * Responsibilities:
 * - 查询当前音频修订的执行轨迹与有界增量。
 * - 为 Worker 创建 PostgreSQL 审计报告器。
 *
 * Notes:
 * - 事件载荷恢复委托给独立 mapper，写入委托给独立 recorder。
 */
import {
  AudioAiExecutionStreamEventSchema,
  AudioAiExecutionTraceResponseSchema,
  type AudioAiExecutionStreamEvent,
} from '@echowave/contracts';

import {
  noOpAiExecutionRecorder,
  type AiExecutionReporter,
} from '../../../ai-observability/executionReporter.ts';
import { quoteIdentifier, type DatabasePool } from '../../../infrastructure/postgres.ts';
import type { LiveUpdateBroker } from '../../../infrastructure/liveUpdateBroker.ts';
import { AudioExecutionEventMapper } from './eventMapping.ts';
import { PostgresAudioExecutionRecorder } from './postgresRecorder.ts';
import { runContext, type EventRow } from './shared.ts';
import type { AudioExecutionQuery } from './repository.ts';

/** 为当前租户实现音频执行查询，并提供 Worker 审计报告器。 */
export class PostgresAudioExecutionRepository implements AudioExecutionQuery {
  private readonly schema: string;
  private readonly resetPromise: Promise<void>;
  private readonly mapper = new AudioExecutionEventMapper();

  constructor(
    private readonly pool: DatabasePool,
    schema: string,
    private readonly tenantId: string,
    private readonly liveUpdates?: LiveUpdateBroker,
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
          this.liveUpdates,
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
      runs: runs.rows.map((run) => this.mapper.mapRun(run, events.rows)),
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
    return result.rows.map((event) =>
      this.mapper.mapStreamEvent(audioFileId, revisionId, event, trace),
    );
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
}
