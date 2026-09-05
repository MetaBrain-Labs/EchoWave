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
import { StyleSheet } from 'react-native';

import { KnowledgeListScreen } from '../KnowledgeListScreen';
import { createKnowledgeBase, listKnowledgeBases } from '../../apiClient';
import { knowledge, knowledgeSummary } from '../../testing/fixtures';
import { colors, radii, spacing } from '@/shared/theme/tokens';

jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));
jest.mock('../../apiClient');

describe('KnowledgeListScreen', () => {
  it('loads server knowledge bases and opens one', async () => {
    jest.mocked(listKnowledgeBases).mockResolvedValue({ items: [knowledgeSummary] });
    const onOpenKnowledge = jest.fn();
    const screen = render(<KnowledgeListScreen onOpenKnowledge={onOpenKnowledge} />);
    expect(await screen.findByText('产品研究知识库')).toBeTruthy();
    expect(StyleSheet.flatten(screen.getByTestId('top-level-page-header').props.style)).toEqual(
      expect.objectContaining({
        paddingBottom: spacing.lg,
        paddingHorizontal: spacing.md,
        paddingTop: spacing.lg,
      }),
    );
    expect(
      screen
        .getByTestId('knowledge-list-scroll')
        .findAllByProps({ testID: 'top-level-page-header' }),
    ).toHaveLength(0);
    expect(StyleSheet.flatten(screen.getByLabelText('新建知识库').props.style)).toEqual(
      expect.objectContaining({
        backgroundColor: colors.card,
        borderColor: colors.divider,
        borderRadius: radii.default,
        minHeight: 44,
      }),
    );
    const cardStyle = StyleSheet.flatten(
      screen.getByLabelText('打开知识库：产品研究知识库').props.style,
    );
    expect(cardStyle).toEqual(
      expect.objectContaining({
        backgroundColor: colors.card,
        borderColor: colors.divider,
        borderRadius: radii.default,
        padding: spacing.md,
      }),
    );
    expect(cardStyle).not.toHaveProperty('minHeight');
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
    jest.mocked(createKnowledgeBase).mockResolvedValue(knowledge);
    const onOpenKnowledge = jest.fn();
    const screen = render(<KnowledgeListScreen onOpenKnowledge={onOpenKnowledge} />);
    await waitFor(() => expect(screen.queryByLabelText('正在加载知识库')).toBeNull());
    fireEvent.press(screen.getByLabelText('新建知识库'));
    expect(screen.getByLabelText('存储位置：本地，不可修改').props.accessibilityState).toEqual({
      disabled: true,
    });
    expect(
      screen.getByLabelText('索引方式：检索增强（RAG），不可修改').props.accessibilityState,
    ).toEqual({ disabled: true });
    fireEvent.changeText(screen.getByLabelText('知识库名称'), '产品研究知识库');
    fireEvent.changeText(screen.getByLabelText('知识库描述'), '真实 API 知识库');
    fireEvent.press(screen.getByText('创建并打开'));
    await screen.findByText('产品研究知识库');
    expect(createKnowledgeBase).toHaveBeenCalledWith('产品研究知识库', '真实 API 知识库');
    expect(onOpenKnowledge).toHaveBeenCalledWith(knowledgeSummary.id);
  });

  it('searches by name or description and distinguishes no matches', async () => {
    const secondKnowledge = {
      ...knowledgeSummary,
      id: 'b0000000-0000-4000-8000-000000000099',
      name: '销售知识库',
      description: '成交话术',
    };
    jest.mocked(listKnowledgeBases).mockResolvedValue({
      items: [knowledgeSummary, secondKnowledge],
    });
    const screen = render(<KnowledgeListScreen onOpenKnowledge={jest.fn()} />);
    await screen.findByText('销售知识库');

    fireEvent.press(screen.getByLabelText('搜索知识库'));
    fireEvent.changeText(screen.getByLabelText('输入知识库搜索关键词'), '  成交  ');
    fireEvent(screen.getByLabelText('输入知识库搜索关键词'), 'submitEditing');
    expect(screen.getByText('销售知识库')).toBeTruthy();
    expect(screen.queryByText('产品研究知识库')).toBeNull();

    fireEvent.press(screen.getByLabelText('搜索知识库'));
    fireEvent.changeText(screen.getByLabelText('输入知识库搜索关键词'), '不存在');
    fireEvent(screen.getByLabelText('输入知识库搜索关键词'), 'submitEditing');
    expect(screen.getByText('没有匹配“不存在”的知识库。')).toBeTruthy();
  });
});
