import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { fontFamilies } from '../../../theme/tokens';
import { KnowledgeDetailScreen } from '../KnowledgeDetailScreen';

describe('KnowledgeDetailScreen', () => {
  const props = {
    knowledgeId: 'kb-1',
    onBack: jest.fn(),
    onOpenDocument: jest.fn(),
  };

  beforeEach(() => jest.clearAllMocks());

  it('uses the content-display title role from DESIGN.md', () => {
    const screen = render(<KnowledgeDetailScreen {...props} />);
    expect(StyleSheet.flatten(screen.getByRole('header').props.style)).toEqual(
      expect.objectContaining({
        fontFamily: fontFamilies.sansBold,
        fontSize: 32,
        fontWeight: 'bold',
        lineHeight: 48,
      }),
    );
  });

  it('filters files and opens only a completed document', () => {
    const screen = render(<KnowledgeDetailScreen {...props} />);

    expect(screen.getByTestId('knowledge-files-scroll').props.stickyHeaderIndices).toEqual([
      1,
    ]);
    expect(
      StyleSheet.flatten(screen.getByLabelText('搜索文档...').props.style),
    ).toEqual(
      expect.objectContaining({
        height: 20,
        includeFontPadding: false,
        paddingVertical: 0,
        textAlignVertical: 'center',
      }),
    );
    expect(
      StyleSheet.flatten(screen.getAllByText('库文件')[0].props.style),
    ).toEqual(expect.objectContaining({ paddingBottom: 4 }));
    fireEvent.changeText(screen.getByLabelText('搜索文档...'), '执行计划');
    expect(screen.getByText('用户研究执行计划')).toBeTruthy();
    expect(screen.queryByText('研究周会纪要')).toBeNull();

    fireEvent.press(screen.getByLabelText('打开文件：用户研究执行计划'));
    expect(props.onOpenDocument).toHaveBeenCalledWith('doc-research-plan');
  });

  it('switches to linked groups by swipe and tab press', () => {
    const screen = render(<KnowledgeDetailScreen {...props} />);

    fireEvent(screen.getByTestId('knowledge-detail-pager'), 'momentumScrollEnd', {
      nativeEvent: { contentOffset: { x: 480, y: 0 } },
    });
    expect(
      screen.getAllByRole('tab', { name: '关联分组' }).some(
        (tab) => tab.props.accessibilityState.selected,
      ),
    ).toBe(true);
    expect(screen.getByText('产品研究组')).toBeTruthy();

    fireEvent.press(screen.getAllByText('库文件')[0]);
    expect(
      screen.getAllByRole('tab', { name: '库文件' }).some(
        (tab) => tab.props.accessibilityState.selected,
      ),
    ).toBe(true);
  });

  it('renders a recoverable unknown-library state', () => {
    const screen = render(<KnowledgeDetailScreen {...props} knowledgeId="missing" />);
    expect(screen.getByText('未找到知识库')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('返回'));
    expect(props.onBack).toHaveBeenCalled();
  });
});
