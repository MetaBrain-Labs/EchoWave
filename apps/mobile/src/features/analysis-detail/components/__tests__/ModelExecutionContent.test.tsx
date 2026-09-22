/**
 * 执行轨迹重排披露测试。
 *
 * 验证重排模型调用以中文名称与量化候选数呈现，且旧事件不会显示空摘要。
 *
 * Responsibilities:
 * - 锁定重排调用的可读名称。
 * - 锁定候选/入选/提升计数只在审计存在时渲染。
 */
import type { AudioAiExecutionTraceResponse } from '@echowave/contracts';
import { fireEvent, render } from '@testing-library/react-native';

import { ModelExecutionContent } from '../ModelExecutionContent';

/** 渲染轨迹并展开唯一的运行卡片，模型调用只在展开后出现。 */
function renderExpandedTrace(trace: AudioAiExecutionTraceResponse) {
  const screen = render(
    <ModelExecutionContent error="" loading={false} onRetry={jest.fn()} trace={trace} />,
  );
  fireEvent.press(screen.getByText('业务分析'));
  return screen;
}

/** 构造一条只含重排模型调用的运行轨迹。 */
function traceWith(rerank?: {
  status: 'applied' | 'disabled' | 'fallback';
  model: string | null;
  candidateCount: number;
  selectedCount: number;
  promotedCount: number;
  reordered: boolean;
  measured: boolean;
  durationMs: number;
  tokens: number;
  fallbackReason: string | null;
}): AudioAiExecutionTraceResponse {
  return {
    runs: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        kind: 'audio-business-analysis',
        name: '业务分析',
        phase: null,
        status: 'completed',
        groupId: null,
        sourceJobId: null,
        startedAt: '2026-09-03T08:00:00.000Z',
        completedAt: '2026-09-03T08:00:10.000Z',
        durationMs: 10_000,
        error: null,
        steps: [],
        modelCalls: [
          {
            id: '22222222-2222-4222-8222-222222222222',
            sequence: 1,
            operation: 'knowledge-rerank',
            name: '知识重排候选',
            provider: 'dashscope',
            model: 'qwen3.7-text-rerank',
            status: 'completed',
            attempt: 1,
            startedAt: '2026-09-03T08:00:00.000Z',
            completedAt: '2026-09-03T08:00:01.000Z',
            durationMs: 300,
            inputTokens: 9,
            outputTokens: 0,
            reasoningMode: 'unsupported',
            reasoningContent: '',
            reasoningTruncated: false,
            estimatedCost: null,
            ...(rerank ? { rerank } : {}),
          },
        ],
        toolCalls: [],
      },
    ],
  };
}

describe('ModelExecutionContent rerank disclosure', () => {
  it('labels the rerank call and shows the stored candidate counts', () => {
    const screen = renderExpandedTrace(
      traceWith({
        status: 'applied',
        model: 'qwen3.7-text-rerank',
        candidateCount: 20,
        selectedCount: 5,
        promotedCount: 2,
        reordered: true,
        measured: true,
        durationMs: 300,
        tokens: 9,
        fallbackReason: null,
      }),
    );

    expect(screen.getByText('知识重排候选')).toBeTruthy();
    expect(screen.getByText('候选 20 条 · 入选 5 条（2 条来自重排提升）')).toBeTruthy();
  });

  it('omits the count line for calls written before the audit existed', () => {
    const screen = renderExpandedTrace(traceWith());

    expect(screen.getByText('知识重排候选')).toBeTruthy();
    expect(screen.queryByText(/条候选 ·/)).toBeNull();
  });
});
