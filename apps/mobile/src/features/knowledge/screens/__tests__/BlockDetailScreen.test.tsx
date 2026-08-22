/**
 * 文档块详情页面测试。
 *
 * 验证块内容、来源预览、上下文导航与固定底部操作。
 *
 * Responsibilities:
 * - 覆盖文档块详情的导航、边界和重点状态。
 *
 * Notes:
 * - 网络调用由 feature 级 mock 控制。
 */
import { fireEvent, render } from '@testing-library/react-native';

import { clearImportantBlocksForTests } from '../../importantBlocks';
import { BlockDetailScreen } from '../BlockDetailScreen';
import { getDocument } from '../../apiClient';
import { document, knowledge } from '../../testing/fixtures';

jest.mock('../../apiClient');

describe('BlockDetailScreen', () => {
  beforeEach(() => {
    clearImportantBlocksForTests();
    jest.mocked(getDocument).mockResolvedValue(document);
  });

  it('shows source and context, then navigates from fixed actions', async () => {
    const onNavigateBlock = jest.fn();
    const onLocateOriginal = jest.fn();
    const screen = render(
      <BlockDetailScreen
        blockId={document.chunks[0]!.id}
        documentId={document.id}
        knowledgeId={knowledge.id}
        onBack={jest.fn()}
        onLocateOriginal={onLocateOriginal}
        onNavigateBlock={onNavigateBlock}
      />,
    );

    expect(await screen.findAllByText('来源位置：研究背景，第 3-5 行')).toHaveLength(2);
    expect(screen.getByLabelText('下一块：核心需求')).toBeTruthy();
    fireEvent.press(screen.getByText('定位原文'));
    expect(onLocateOriginal).toHaveBeenCalledWith(document.chunks[0]?.id);
    fireEvent.press(screen.getByText('下一块'));
    expect(onNavigateBlock).toHaveBeenCalledWith(document.chunks[1]?.id);
    expect(screen.getByTestId('block-fixed-footer')).toBeTruthy();
  });

  it('toggles important state and exposes pagination boundaries', async () => {
    const screen = render(
      <BlockDetailScreen
        blockId={document.chunks[1]!.id}
        documentId={document.id}
        knowledgeId={knowledge.id}
        onBack={jest.fn()}
        onLocateOriginal={jest.fn()}
        onNavigateBlock={jest.fn()}
      />,
    );
    expect(await screen.findAllByText('回答需要关联原始证据。')).toHaveLength(2);

    fireEvent.press(screen.getByText('设为重点'));
    expect(screen.getByText('取消重点')).toBeTruthy();
    expect(screen.getByRole('button', { name: '下一块' }).props.accessibilityState).toEqual({
      disabled: true,
    });
    expect(screen.getByRole('button', { name: '上一块' }).props.accessibilityState).toEqual({
      disabled: false,
    });
  });
});
