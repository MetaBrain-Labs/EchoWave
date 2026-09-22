/**
 * 智能重排披露组件测试。
 *
 * 验证四种文案分支与"没有测量过效果时不得声称与向量顺序一致"。
 *
 * Responsibilities:
 * - 锁定生效、未测量、降级与关闭四种状态的渲染结果。
 */
import type { RerankDisclosure as RerankDisclosureValue } from '@echowave/contracts';
import { render } from '@testing-library/react-native';

import { RerankDisclosure } from '../RerankDisclosure';

/** 构造一份披露，默认是"已测量且有两处提升"。 */
function disclosure(overrides: Partial<RerankDisclosureValue> = {}): RerankDisclosureValue {
  return {
    status: 'applied',
    model: 'qwen3.7-text-rerank',
    candidateCount: 20,
    selectedCount: 5,
    promotedCount: 2,
    reordered: true,
    measured: true,
    durationMs: 380,
    tokens: 12,
    fallbackReason: null,
    ...overrides,
  };
}

describe('RerankDisclosure', () => {
  it('reports the measured effect with candidate, selection and duration numbers', () => {
    const screen = render(<RerankDisclosure disclosure={disclosure()} />);

    expect(
      screen.getByText(
        '已使用智能重排（qwen3.7-text-rerank）对 20 条候选重新排序：入选 5 条证据，其中 2 条来自重排提升（380 ms）。',
      ),
    ).toBeTruthy();
  });

  it('states a stable result only when the effect was actually measured', () => {
    const measured = render(
      <RerankDisclosure disclosure={disclosure({ promotedCount: 0, reordered: false })} />,
    );
    expect(measured.getByText(/结果与向量召回一致/)).toBeTruthy();

    const unmeasured = render(<RerankDisclosure disclosure={disclosure({ measured: false })} />);
    expect(unmeasured.queryByText(/结果与向量召回一致/)).toBeNull();
    expect(
      unmeasured.getByText('已使用智能重排（qwen3.7-text-rerank）对 20 条候选重新排序（380 ms）。'),
    ).toBeTruthy();
  });

  it('names the missing configuration when reranking fell back for that reason', () => {
    const screen = render(
      <RerankDisclosure
        disclosure={disclosure({ status: 'fallback', fallbackReason: 'NOT_CONFIGURED' })}
      />,
    );

    expect(
      screen.getByText('重排已开启，但百炼业务空间或重排模型尚未配置，本次使用向量检索结果。'),
    ).toBeTruthy();
  });

  it('renders nothing while reranking is disabled', () => {
    const screen = render(<RerankDisclosure disclosure={disclosure({ status: 'disabled' })} />);

    expect(screen.queryByTestId('rerank-disclosure')).toBeNull();
  });
});
