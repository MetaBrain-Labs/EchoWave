/**
 * 可信回答引用列表测试。
 *
 * 验证超过四条引用时默认折叠，并允许用户展开、访问来源后再次收起；
 * 同时验证正文标记跳转会在展开后定位卡片并高亮目标。
 *
 * Responsibilities:
 * - 锁定引用展示阈值与完整数据保留语义。
 * - 锁定展开后的引用编号与来源清单一致。
 * - 覆盖展开按钮的可访问名称和来源跳转。
 * - 覆盖正文标记触发的跳转偏移与高亮。
 */
import { act, createRef } from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { CitationList, type CitationListHandle } from '../CitationList';
import { colors } from '@/shared/theme/tokens';

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

/** 取引用卡片根节点：卡片是同时带 onPress 与 onLayout 的 link 容器，子级 Text 也会转发 link 角色。 */
function cardNodes(screen: ReturnType<typeof render>) {
  return screen
    .UNSAFE_getAllByProps({ accessibilityRole: 'link' })
    .filter(
      (node) =>
        typeof node.props.onLayout === 'function' && typeof node.props.onPress === 'function',
    );
}

function cardBackground(node: { props: { style?: unknown } }) {
  const styles = (
    (Array.isArray(node.props.style) ? node.props.style : [node.props.style]).filter(
      Boolean,
    ) as Record<string, unknown>[]
  ).flatMap((style) => (typeof style === 'object' ? [style] : []));
  return styles.map((style) => style.backgroundColor).filter(Boolean);
}

describe('CitationList', () => {
  it('shows four citations by default and expands or collapses the remainder', () => {
    const onOpenCitation = jest.fn();
    const screen = render(<CitationList citations={citations} onOpenCitation={onOpenCitation} />);

    expect(screen.getByText('[4] 来源 4')).toBeTruthy();
    expect(screen.queryByText('[5] 来源 5')).toBeNull();
    expect(screen.queryByText('[6] 来源 6')).toBeNull();

    fireEvent.press(screen.getByLabelText('展开其余 2 条引用来源'));
    // 展开后必须呈现完整引用清单，不因折叠阈值丢弃任何来源。
    for (const citation of citations) {
      expect(screen.getByText(`[${citation.number}] ${citation.documentTitle}`)).toBeTruthy();
    }

    fireEvent.press(screen.getByText('[6] 来源 6'));
    expect(screen.getByText('来源 6')).toBeTruthy();
    expect(screen.getByText('来源不可用，仅展示已保存的引用。')).toBeTruthy();
    expect(onOpenCitation).not.toHaveBeenCalled();
    fireEvent.press(screen.getByText('关闭'));

    fireEvent.press(screen.getByText('[5] 来源 5'));
    expect(screen.getByText('来源 5')).toBeTruthy();
    fireEvent.press(screen.getByText('关闭'));

    fireEvent.press(screen.getByLabelText('收起引用来源'));
    expect(screen.queryByText('[5] 来源 5')).toBeNull();
    expect(screen.queryByText('[6] 来源 6')).toBeNull();
  });

  it('renumbers citation numbers that exceed the visible list', () => {
    const legacy = citations.map((citation, index) => ({
      ...citation,
      // 旧数据里最后一条的编号越过了清单长度，展示时必须收敛回清单内。
      number: index === citations.length - 1 ? citations.length + 1 : citation.number,
    }));
    const screen = render(<CitationList citations={legacy} onOpenCitation={jest.fn()} />);

    expect(screen.queryByText(`[${citations.length + 1}] 来源 ${citations.length}`)).toBeNull();

    fireEvent.press(screen.getByLabelText('展开其余 2 条引用来源'));
    for (const citation of citations) {
      expect(screen.getByText(`[${citation.number}] ${citation.documentTitle}`)).toBeTruthy();
    }
  });

  it('does not render a disclosure control for four or fewer citations', () => {
    const screen = render(
      <CitationList citations={citations.slice(0, 4)} onOpenCitation={jest.fn()} />,
    );

    expect(screen.queryByLabelText(/展开其余/)).toBeNull();
    expect(screen.queryByLabelText('收起引用来源')).toBeNull();
  });

  it('expands to a collapsed citation and reports its measured offset', () => {
    const onScrollToOffset = jest.fn();
    const onScrolled = jest.fn();
    const handle = createRef<CitationListHandle>();
    const screen = render(
      <CitationList
        citations={citations}
        onOpenCitation={jest.fn()}
        onScrollToOffset={onScrollToOffset}
        onScrolled={onScrolled}
        ref={handle}
      />,
    );

    // 折叠状态下第 6 条尚未渲染，跳转必须先展开再等待布局上报。
    act(() => handle.current?.scrollToCitation(6));
    expect(screen.getByText('[6] 来源 6')).toBeTruthy();

    const cards = cardNodes(screen);
    expect(cards).toHaveLength(6);
    cards.forEach((card) => {
      fireEvent(card, 'layout', { nativeEvent: { layout: { height: 40, y: 0 } } });
    });

    // 六张卡片各高 40、间距 8，因此第 6 条起点为 5 × 48。
    expect(onScrollToOffset).toHaveBeenCalledWith(5 * 48, 40);
    expect(onScrolled).toHaveBeenCalled();
  });

  it('highlights the targeted citation card', () => {
    const screen = render(
      <CitationList citations={citations} highlightedNumber={2} onOpenCitation={jest.fn()} />,
    );

    const cards = cardNodes(screen);
    expect(cardBackground(cards[1]!)).toEqual([colors.background, colors.primarySurface]);
    expect(cardBackground(cards[0]!)).toEqual([colors.background]);
  });
});
