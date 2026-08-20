/**
 * 知识文档详情页面测试。
 *
 * 验证新版解析布局、原文预览、滑动分页和会话级重点标记。
 *
 * Responsibilities:
 * - 覆盖文档详情主要交互和固定操作区。
 *
 * Notes:
 * - 使用符合共享契约的固定数据。
 */
import { fireEvent, render } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { clearImportantBlocksForTests } from '../../importantBlocks';
import { DocumentDetailScreen } from '../DocumentDetailScreen';
import { getDocument } from '../../apiClient';
import { document, knowledge } from '../../testing/fixtures';

jest.mock('../../apiClient');

describe('DocumentDetailScreen', () => {
  beforeEach(() => {
    clearImportantBlocksForTests();
    jest.mocked(getDocument).mockResolvedValue(document);
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('renders metrics, filters chunks, and keeps search sticky', async () => {
    const onOpenBlock = jest.fn();
    const screen = render(<DocumentDetailScreen documentId={document.id} knowledgeId={knowledge.id} onBack={jest.fn()} onOpenBlock={onOpenBlock} />);

    expect(await screen.findByText('块 1 · 研究背景')).toBeTruthy();
    expect(screen.getByText('文本块列表（2）')).toBeTruthy();
    expect(screen.getByText('28')).toBeTruthy();
    expect(screen.getByTestId('document-parsed-scroll').props.stickyHeaderIndices).toEqual([1]);

    fireEvent.changeText(screen.getByLabelText('搜索解析内容...'), '核心需求');
    expect(screen.queryByText('块 1 · 研究背景')).toBeNull();
    fireEvent.press(screen.getByLabelText('打开文本块：核心需求'));
    expect(onOpenBlock).toHaveBeenCalledWith(document.chunks[1]?.id);
  });

  it('switches pages by swipe and supports code and fullscreen preview', async () => {
    const screen = render(<DocumentDetailScreen documentId={document.id} knowledgeId={knowledge.id} onBack={jest.fn()} onOpenBlock={jest.fn()} />);
    await screen.findByText('文档原文');

    fireEvent(screen.getByTestId('document-detail-pager'), 'momentumScrollEnd', {
      nativeEvent: { contentOffset: { x: 480, y: 0 } },
    });
    expect(screen.getByRole('tab', { name: '文档原文' }).props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByText(document.previewText)).toBeTruthy();

    fireEvent.press(screen.getByRole('tab', { name: '代码' }));
    expect(screen.getByRole('tab', { name: '代码' }).props.accessibilityState).toEqual({ selected: true });
    fireEvent.press(screen.getByLabelText('全屏预览'));
    expect(screen.getByTestId('document-fullscreen-preview')).toBeTruthy();
    expect(screen.queryByLabelText('返回')).toBeNull();
    expect(screen.getByText(document.previewText)).toBeTruthy();
    fireEvent.press(screen.getByLabelText('退出全屏预览'));
    expect(screen.getByLabelText('返回')).toBeTruthy();
  });

  it('shares important state and keeps reparse as explicit feedback', async () => {
    const screen = render(<DocumentDetailScreen documentId={document.id} knowledgeId={knowledge.id} onBack={jest.fn()} onOpenBlock={jest.fn()} />);
    await screen.findByLabelText('设为重点：研究背景');

    fireEvent.press(screen.getByLabelText('设为重点：研究背景'));
    expect(screen.getByLabelText('取消重点：研究背景')).toBeTruthy();

    fireEvent.press(screen.getAllByText('重新解析')[0]!);
    expect(Alert.alert).toHaveBeenCalledWith('功能建设中', expect.stringContaining('成功文档重新解析'));
    expect(screen.getAllByTestId('document-fixed-action')).toHaveLength(2);
  });
});
