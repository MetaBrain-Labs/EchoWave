/**
 * 可信回答引用列表测试。
 *
 * 验证超过四条引用时默认折叠，并允许用户展开、访问来源后再次收起。
 *
 * Responsibilities:
 * - 锁定引用展示阈值与完整数据保留语义。
 * - 覆盖展开按钮的可访问名称和来源跳转。
 */
import { fireEvent, render } from '@testing-library/react-native';

import { CitationList } from '../CitationList';

const citations = Array.from({ length: 6 }, (_, index) => {
  const number = index + 1;
  return {
    number,
    documentId: `44444444-4444-4444-8444-${String(number).padStart(12, '0')}`,
    documentTitle: `来源 ${number}`,
    chunkId: `33333333-3333-4333-8333-${String(number).padStart(12, '0')}`,
    locator: {
      kind: 'markdown' as const,
      headingPath: ['结论'],
      lineStart: number,
      lineEnd: number,
    },
    excerpt: `第 ${number} 条依据`,
  };
});

describe('CitationList', () => {
  it('shows four citations by default and expands or collapses the remainder', () => {
    const onOpenCitation = jest.fn();
    const screen = render(<CitationList citations={citations} onOpenCitation={onOpenCitation} />);

    expect(screen.getByText('[4] 来源 4')).toBeTruthy();
    expect(screen.queryByText('[5] 来源 5')).toBeNull();
    expect(screen.queryByText('[6] 来源 6')).toBeNull();

    fireEvent.press(screen.getByLabelText('展开其余 2 条引用来源'));
    expect(screen.getByText('[5] 来源 5')).toBeTruthy();
    expect(screen.getByText('[6] 来源 6')).toBeTruthy();

    fireEvent.press(screen.getByText('[6] 来源 6'));
    expect(onOpenCitation).toHaveBeenCalledWith(citations[5]?.documentId, citations[5]?.chunkId);

    fireEvent.press(screen.getByLabelText('收起引用来源'));
    expect(screen.queryByText('[5] 来源 5')).toBeNull();
  });

  it('does not render a disclosure control for four or fewer citations', () => {
    const screen = render(
      <CitationList citations={citations.slice(0, 4)} onOpenCitation={jest.fn()} />,
    );

    expect(screen.queryByLabelText(/展开其余/)).toBeNull();
    expect(screen.queryByLabelText('收起引用来源')).toBeNull();
  });
});
