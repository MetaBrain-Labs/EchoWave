import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { DocumentDetailScreen } from '../DocumentDetailScreen';
import { resetImportantBlockIds } from '../preferences';

describe('DocumentDetailScreen', () => {
  const props = {
    documentId: 'doc-interview-workflow',
    knowledgeId: 'kb-1',
    onBack: jest.fn(),
    onOpenBlock: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    resetImportantBlockIds();
  });

  it('filters parsed blocks, toggles emphasis, and opens a block', () => {
    const screen = render(<DocumentDetailScreen {...props} />);

    expect(
      StyleSheet.flatten(screen.getByLabelText('搜索解析内容...').props.style),
    ).toEqual(
      expect.objectContaining({
        height: 20,
        includeFontPadding: false,
        paddingVertical: 0,
        textAlignVertical: 'center',
      }),
    );
    expect(screen.getByTestId('document-parsed-scroll').props.stickyHeaderIndices).toEqual([
      4,
    ]);
    fireEvent.changeText(screen.getByLabelText('搜索解析内容...'), '产品机会');
    expect(screen.getByText('块 4 · 产品机会')).toBeTruthy();
    expect(screen.queryByText('块 1 · 研究背景')).toBeNull();

    fireEvent.press(screen.getByLabelText('设为重点'));
    expect(screen.getByLabelText('取消重点')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('打开文本块 4：产品机会'));
    expect(props.onOpenBlock).toHaveBeenCalledWith('block-opportunity');
  });

  it('switches to the original page, code mode, and fullscreen preview', () => {
    const screen = render(<DocumentDetailScreen {...props} />);

    fireEvent.press(screen.getByText('文档原文'));
    expect(StyleSheet.flatten(screen.getByText('文档原文').props.style)).toEqual(
      expect.objectContaining({ paddingBottom: 4 }),
    );
    fireEvent.press(screen.getByText('代码'));
    expect(StyleSheet.flatten(screen.getByText('预览').props.style)).toEqual(
      expect.objectContaining({ paddingBottom: 4 }),
    );
    expect(screen.getByText(/# 音频访谈整理研究/)).toBeTruthy();

    fireEvent.press(screen.getByLabelText('进入全屏预览'));
    expect(screen.getByLabelText('退出全屏预览')).toBeTruthy();
    expect(screen.queryByLabelText('返回')).toBeNull();

    fireEvent.press(screen.getByLabelText('退出全屏预览'));
    expect(screen.getByLabelText('返回')).toBeTruthy();
  });

  it('synchronizes document tabs after a swipe', () => {
    const screen = render(<DocumentDetailScreen {...props} />);
    fireEvent(screen.getByTestId('document-detail-pager'), 'momentumScrollEnd', {
      nativeEvent: { contentOffset: { x: 480, y: 0 } },
    });
    expect(screen.getByRole('tab', { name: '文档原文' }).props.accessibilityState).toEqual({
      selected: true,
    });
  });
});
