/**
 * 知识库目录页面测试。
 *
 * 验证列表加载、知识库创建、错误状态和详情导航行为。
 *
 * Responsibilities:
 * - 覆盖知识库目录的主要交互流程。
 *
 * Notes:
 * - 不依赖真实 API。
 */
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { KnowledgeListScreen } from '../KnowledgeListScreen';
import { createKnowledgeBase, listKnowledgeBases } from '../apiClient';
import { knowledgeSummary } from '../testFixtures';

jest.mock('../apiClient');

describe('KnowledgeListScreen', () => {
  it('loads server knowledge bases and opens one', async () => {
    jest.mocked(listKnowledgeBases).mockResolvedValue({ items: [knowledgeSummary] });
    const onOpenKnowledge = jest.fn();
    const screen = render(<KnowledgeListScreen onOpenKnowledge={onOpenKnowledge} />);
    expect(await screen.findByText('产品研究知识库')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('打开知识库：产品研究知识库'));
    expect(onOpenKnowledge).toHaveBeenCalledWith(knowledgeSummary.id);
  });

  it('offers retry after an API failure', async () => {
    jest.mocked(listKnowledgeBases).mockRejectedValue(new Error('网络不可用'));
    const screen = render(<KnowledgeListScreen onOpenKnowledge={jest.fn()} />);
    expect(await screen.findByText('网络不可用')).toBeTruthy();
    expect(screen.getByText('点击重试')).toBeTruthy();
  });

  it('creates a knowledge base and opens it', async () => {
    jest.mocked(listKnowledgeBases).mockResolvedValue({ items: [] });
    jest.mocked(createKnowledgeBase).mockResolvedValue(knowledgeSummary);
    const onOpenKnowledge = jest.fn();
    const screen = render(<KnowledgeListScreen onOpenKnowledge={onOpenKnowledge} />);
    await waitFor(() => expect(screen.queryByLabelText('正在加载知识库')).toBeNull());
    fireEvent.press(screen.getByLabelText('新建知识库'));
    fireEvent.changeText(screen.getByLabelText('知识库名称'), '产品研究知识库');
    fireEvent.changeText(screen.getByLabelText('知识库描述'), '真实 API 知识库');
    fireEvent.press(screen.getByText('创建并打开'));
    await screen.findByText('产品研究知识库');
    expect(createKnowledgeBase).toHaveBeenCalledWith('产品研究知识库', '真实 API 知识库');
    expect(onOpenKnowledge).toHaveBeenCalledWith(knowledgeSummary.id);
  });
});
