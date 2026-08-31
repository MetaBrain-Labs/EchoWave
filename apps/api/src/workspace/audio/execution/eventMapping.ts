/**
 * 音频执行事件映射。
 *
 * 将 PostgreSQL 运行与事件行恢复为 contracts 定义的轨迹和 SSE 增量。
 *
 * Responsibilities:
 * - 聚合 step、model call、tool call 与 reasoning 增量。
 * - 构造游标事件对应的完整稳定载荷。
 *
 * Notes:
 * - 本模块不执行 SQL，也不修改审计记录。
 */
import {
  AudioAiExecutionStreamEventSchema,
  type AudioAiExecutionStreamEvent,
  type AudioAiExecutionTraceResponse,
} from '@echowave/contracts';

import {
  MODEL_DISPLAY_NAMES,
  REASONING_LIMIT,
  TOOL_DISPLAY_NAMES,
  displayName,
  integer,
  iso,
  object,
  text,
  type EventRow,
} from './shared.ts';

/** 将持久化事件映射为产品执行轨迹。 */
export class AudioExecutionEventMapper {
  mapRun(run: Record<string, any>, allEvents: EventRow[]) {
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
      steps: this.mapSteps(events.filter((event) => event.event_type === 'step')),
      modelCalls: [...modelOperations.values()]
        .map((operationEvents) => this.mapModelCall(operationEvents, run))
        .sort((left, right) => left.sequence - right.sequence),
      toolCalls: [...toolOperations.values()]
        .map((operationEvents) => this.mapToolCall(operationEvents, run))
        .sort((left, right) => left.sequence - right.sequence),
    };
  }

  /** 将成对步骤恢复为一条生命周期记录，并兼容旧版不同 operation_id 的相邻事件。 */
  private mapSteps(events: EventRow[]) {
    type LogicalStep = { first: EventRow; terminal?: EventRow };
    const logicalSteps: LogicalStep[] = [];
    const byOperation = new Map<string, LogicalStep>();
    const pendingByName = new Map<string, LogicalStep[]>();

    for (const event of [...events].sort(
      (left, right) => Number(left.sequence_no) - Number(right.sequence_no),
    )) {
      if (event.status === 'started') {
        const logical = { first: event };
        logicalSteps.push(logical);
        byOperation.set(event.operation_id, logical);
        const pending = pendingByName.get(event.name) ?? [];
        pending.push(logical);
        pendingByName.set(event.name, pending);
        continue;
      }

      const sameOperation = byOperation.get(event.operation_id);
      const pending = pendingByName.get(event.name) ?? [];
      const logical = sameOperation ?? pending.shift();
      if (logical) {
        logical.terminal = event;
        const pendingIndex = pending.indexOf(logical);
        if (pendingIndex >= 0) pending.splice(pendingIndex, 1);
        if (pending.length === 0) pendingByName.delete(event.name);
        else pendingByName.set(event.name, pending);
      } else {
        const terminalOnly = { first: event, terminal: event };
        logicalSteps.push(terminalOnly);
        byOperation.set(event.operation_id, terminalOnly);
      }
    }

    return logicalSteps.map(({ first, terminal }) => ({
      id: first.operation_id,
      sequence: Number(first.sequence_no),
      name: first.name,
      status: terminal?.status ?? 'started',
      occurredAt: iso(first.occurred_at),
      durationMs: terminal
        ? (integer(terminal.duration_ms) ??
          (terminal === first
            ? 0
            : Math.max(
                0,
                new Date(terminal.occurred_at).getTime() - new Date(first.occurred_at).getTime(),
              )))
        : null,
      summary: object(terminal?.details ?? first.details)?.summary ?? {},
    }));
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

  mapStreamEvent(
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
        (item) =>
          item.id === event.operation_id ||
          (item.name === event.name && item.status === event.status),
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
