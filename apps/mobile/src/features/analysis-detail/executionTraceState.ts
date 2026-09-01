/**
 * 音频执行轨迹实时状态归并。
 *
 * 将服务端 SSE 增量安全地应用到当前分析 revision 的权威轨迹，拒绝无法定位目标的事件。
 *
 * Responsibilities:
 * - 保证不同音频或 revision 的事件不会污染当前轨迹。
 * - 在模型、步骤、工具和 reasoning 增量成功归并后返回新的不可变快照。
 *
 * Notes:
 * - 返回 undefined 表示事件没有被应用，调用方不得推进持久化事件游标。
 */
import type {
  AudioAiExecutionStreamEvent,
  AudioAiExecutionTraceResponse,
} from '@echowave/contracts';

type IncrementalEvent = Exclude<
  AudioAiExecutionStreamEvent,
  { type: 'snapshot' | 'heartbeat' | 'error' }
>;

function matchingTrace(
  trace: AudioAiExecutionTraceResponse | undefined,
  event: AudioAiExecutionStreamEvent,
): trace is AudioAiExecutionTraceResponse {
  return Boolean(
    trace &&
    trace.audioFileId === event.audioFileId &&
    trace.analysisRevisionId === event.analysisRevisionId,
  );
}

function updateRun(
  trace: AudioAiExecutionTraceResponse,
  event: IncrementalEvent,
  update: (
    run: AudioAiExecutionTraceResponse['runs'][number],
  ) => AudioAiExecutionTraceResponse['runs'][number] | undefined,
): AudioAiExecutionTraceResponse | undefined {
  const index = trace.runs.findIndex((run) => run.id === event.runId);
  if (index < 0) return undefined;
  const nextRun = update(trace.runs[index]!);
  if (!nextRun) return undefined;
  return {
    ...trace,
    runs: trace.runs.map((run, runIndex) => (runIndex === index ? nextRun : run)),
  };
}

/** 将一个持久化 SSE 事件应用到本地轨迹；无法应用时拒绝消费该事件。 */
export function applyExecutionTraceEvent(
  trace: AudioAiExecutionTraceResponse | undefined,
  event: AudioAiExecutionStreamEvent,
): AudioAiExecutionTraceResponse | undefined {
  if (event.type === 'snapshot') {
    return matchingTrace(event.trace, event) ? event.trace : undefined;
  }
  if (event.type === 'heartbeat' || event.type === 'error') return trace;
  if (!matchingTrace(trace, event)) return undefined;

  if (event.type === 'run-status') {
    const exists = trace.runs.some((run) => run.id === event.runId);
    return {
      ...trace,
      runs: exists
        ? trace.runs.map((run) => (run.id === event.runId ? event.run : run))
        : [event.run, ...trace.runs],
    };
  }
  if (event.type === 'step') {
    return updateRun(trace, event, (run) => {
      const exists = run.steps.some((step) => step.id === event.step.id);
      const steps = exists
        ? run.steps.map((step) => (step.id === event.step.id ? event.step : step))
        : [...run.steps, event.step];
      return { ...run, steps: steps.sort((left, right) => left.sequence - right.sequence) };
    });
  }
  if (event.type === 'model-start' || event.type === 'model-finish') {
    return updateRun(trace, event, (run) => {
      const exists = run.modelCalls.some((call) => call.id === event.operationId);
      const modelCalls = exists
        ? run.modelCalls.map((call) => (call.id === event.operationId ? event.modelCall : call))
        : [...run.modelCalls, event.modelCall];
      return {
        ...run,
        modelCalls: modelCalls.sort((left, right) => left.sequence - right.sequence),
      };
    });
  }
  if (event.type === 'tool-start' || event.type === 'tool-finish') {
    return updateRun(trace, event, (run) => {
      const exists = run.toolCalls.some((tool) => tool.id === event.operationId);
      const toolCalls = exists
        ? run.toolCalls.map((tool) => (tool.id === event.operationId ? event.toolCall : tool))
        : [...run.toolCalls, event.toolCall];
      return {
        ...run,
        toolCalls: toolCalls.sort((left, right) => left.sequence - right.sequence),
      };
    });
  }
  if (event.type !== 'reasoning-delta') return undefined;
  return updateRun(trace, event, (run) => {
    const exists = run.modelCalls.some((call) => call.id === event.operationId);
    if (!exists) return undefined;
    return {
      ...run,
      modelCalls: run.modelCalls.map((call) =>
        call.id !== event.operationId
          ? call
          : {
              ...call,
              reasoningContent: `${call.reasoningContent}${event.delta}`.slice(0, 120_000),
              reasoningTruncated: call.reasoningTruncated || event.truncated,
            },
      ),
    };
  });
}

/** 判断轨迹中是否仍有需要使用服务端快照收敛的运行中记录。 */
export function hasRunningExecution(trace: AudioAiExecutionTraceResponse | undefined): boolean {
  return Boolean(
    trace?.runs.some(
      (run) =>
        run.status === 'running' ||
        run.steps.some((step) => step.status === 'started') ||
        run.modelCalls.some((call) => call.status === 'running') ||
        run.toolCalls.some((tool) => tool.status === 'running'),
    ),
  );
}
