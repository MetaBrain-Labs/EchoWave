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

import { clearImportantBlocksForTests } from '../../importantBlocks';
import { DocumentDetailScreen } from '../DocumentDetailScreen';
import { getDocument } from '../../apiClient';
import { document, knowledge } from '../../testing/fixtures';
import { colors } from '@/shared/theme/tokens';

jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));
jest.mock('../../apiClient');

describe('DocumentDetailScreen', () => {
  beforeEach(() => {
    clearImportantBlocksForTests();
    jest.mocked(getDocument).mockResolvedValue(document);
  });

  afterEach(() => jest.restoreAllMocks());

  it('renders metrics, filters chunks, and keeps search sticky', async () => {
    const onOpenBlock = jest.fn();
    const screen = render(
      <DocumentDetailScreen
        documentId={document.id}
        knowledgeId={knowledge.id}
        onBack={jest.fn()}
        onOpenBlock={onOpenBlock}
      />,
    );

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
    const screen = render(
      <DocumentDetailScreen
        documentId={document.id}
        knowledgeId={knowledge.id}
        onBack={jest.fn()}
        onOpenBlock={jest.fn()}
      />,
    );
    await screen.findByText('文档原文');

    fireEvent(screen.getByTestId('document-detail-pager'), 'momentumScrollEnd', {
      nativeEvent: { contentOffset: { x: 480, y: 0 } },
    });
    expect(screen.getByRole('tab', { name: '文档原文' }).props.accessibilityState).toEqual({
      selected: true,
    });
    expect(screen.getByText(document.previewText)).toBeTruthy();

    fireEvent.press(screen.getByRole('tab', { name: '代码' }));
    expect(screen.getByRole('tab', { name: '代码' }).props.accessibilityState).toEqual({
      selected: true,
    });
    fireEvent.press(screen.getByLabelText('全屏预览'));
    expect(screen.getByTestId('document-fullscreen-preview')).toBeTruthy();
    expect(screen.queryByLabelText('返回')).toBeNull();
    expect(screen.getByText(document.previewText)).toBeTruthy();
    fireEvent.press(screen.getByLabelText('退出全屏预览'));
    expect(screen.getByLabelText('返回')).toBeTruthy();
  });

  it('starts on the original page when opened from block location', async () => {
    const screen = render(
      <DocumentDetailScreen
        documentId={document.id}
        initialBlockId={document.chunks[0]?.id}
        initialTab="original"
        knowledgeId={knowledge.id}
        onBack={jest.fn()}
        onOpenBlock={jest.fn()}
      />,
    );

    expect(await screen.findByTestId('document-original-scroll')).toBeTruthy();
    expect(screen.getByRole('tab', { name: '文档原文' }).props.accessibilityState).toEqual({
      selected: true,
    });
    expect(screen.getByTestId('document-detail-pager').props.contentOffset).toEqual({
      x: 480,
      y: 0,
    });
  });

  it('scrolls to and highlights the located original block', async () => {
    const target = document.chunks[0]!;
    const locatedDocument = {
      ...document,
      previewText: `开头\n${target.sourceExcerpt}\n结尾`,
    };
    jest.mocked(getDocument).mockResolvedValueOnce(locatedDocument);
    const screen = render(
      <DocumentDetailScreen
        documentId={document.id}
        initialBlockId={target.id}
        initialTab="original"
        knowledgeId={knowledge.id}
        onBack={jest.fn()}
        onOpenBlock={jest.fn()}
      />,
    );

    const targetLine = await screen.findByTestId('document-original-target-line');
    expect(
      screen.getAllByText(target.sourceExcerpt).some((match) => {
        const styles = Array.isArray(match.props.style) ? match.props.style : [match.props.style];
        return styles.some((style) => style?.backgroundColor === colors.successSurface);
      }),
    ).toBe(true);

    fireEvent(screen.getByTestId('document-preview'), 'layout', {
      nativeEvent: { layout: { y: 200 } },
    });
    fireEvent(targetLine, 'layout', { nativeEvent: { layout: { y: 300 } } });
    expect(screen.getByTestId('document-original-target-line')).toBeTruthy();
  });

  it('shares important state and opens explicit version actions', async () => {
    const screen = render(
      <DocumentDetailScreen
        documentId={document.id}
        knowledgeId={knowledge.id}
        onBack={jest.fn()}
        onOpenBlock={jest.fn()}
      />,
    );
    await screen.findByLabelText('设为重点：研究背景');

    fireEvent.press(screen.getByLabelText('设为重点：研究背景'));
    expect(screen.getByLabelText('取消重点：研究背景')).toBeTruthy();

    fireEvent.press(screen.getAllByText('重新解析')[0]!);
    expect(screen.getByText('修改文件名')).toBeTruthy();
    expect(screen.getByText('替换文件')).toBeTruthy();
    expect(screen.getByText('删除文件')).toBeTruthy();
    expect(screen.getAllByTestId('document-fixed-action')).toHaveLength(2);
  });

  it('shows the latest failure while retaining the active document content', async () => {
    const message = '新版向量生成失败，旧版仍可用。';
    jest.mocked(getDocument).mockResolvedValueOnce({
      ...document,
      version: 2,
      activeRevisionId: '77777777-7777-4777-8777-777777777777',
      latestRevision: {
        id: '88888888-8888-4888-8888-888888888888',
        version: 2,
        title: '待发布的新文件.md',
        status: 'failed',
        stage: 'embed',
        progress: 50,
        error: { code: 'UPSTREAM', message, retryable: true },
      },
    });
    const screen = render(
      <DocumentDetailScreen
        documentId={document.id}
        knowledgeId={knowledge.id}
        onBack={jest.fn()}
        onOpenBlock={jest.fn()}
      />,
    );
    expect(await screen.findByText(/新版向量生成失败/)).toBeTruthy();
    expect(screen.getByText('块 1 · 研究背景')).toBeTruthy();
    fireEvent.press(screen.getAllByText('重新解析')[0]!);
    expect(screen.getByText('查看失败原因')).toBeTruthy();
    fireEvent.press(screen.getByText('查看失败原因'));
    expect(screen.getByText(message)).toBeTruthy();
  });
});
