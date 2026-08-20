/**
 * 文档块详情页面测试。
 *
 * 验证服务器文档块、来源定位及相邻块导航的渲染行为。
 *
 * Responsibilities:
 * - 覆盖文档块详情的加载与导航结果。
 *
 * Notes:
 * - 网络调用由测试替身提供。
 */
import { fireEvent, render } from '@testing-library/react-native';

import { BlockDetailScreen } from '../BlockDetailScreen';
import { getDocument } from '../apiClient';
import { document, knowledge } from '../testFixtures';

jest.mock('../apiClient');

describe('BlockDetailScreen', () => {
  beforeEach(() => jest.mocked(getDocument).mockResolvedValue(document));

  it('shows a real source locator and navigates adjacent chunks', async () => {
    const onNavigateBlock = jest.fn();
    const screen = render(<BlockDetailScreen blockId={document.chunks[0]!.id} documentId={document.id} knowledgeId={knowledge.id} onBack={jest.fn()} onLocateOriginal={jest.fn()} onNavigateBlock={onNavigateBlock} />);
    expect(await screen.findByText('研究背景，第 3-5 行')).toBeTruthy();
    fireEvent.press(screen.getByText('下一块'));
    expect(onNavigateBlock).toHaveBeenCalledWith(document.chunks[1]?.id);
  });

  it('keeps the requested citation chunk highlighted as the only content card', async () => {
    const screen = render(<BlockDetailScreen blockId={document.chunks[1]!.id} documentId={document.id} knowledgeId={knowledge.id} onBack={jest.fn()} onLocateOriginal={jest.fn()} onNavigateBlock={jest.fn()} />);
    expect(await screen.findByText('回答需要关联原始证据。')).toBeTruthy();
  });
});
