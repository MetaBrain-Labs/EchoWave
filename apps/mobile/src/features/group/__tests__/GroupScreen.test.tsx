/**
 * 分组工作区页面测试。
 *
 * 验证标签、状态展示、刷新和导航回调等分组纵切片行为。
 *
 * Responsibilities:
 * - 覆盖用户可观察的分组页面交互。
 *
 * Notes:
 * - 服务端响应通过共享工作区适配器 mock 注入。
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import { StyleSheet } from 'react-native';

import { GroupScreen } from '../GroupScreen';
import * as dataSourcesApi from '@/shared/api/dataSourcesApi';
import * as workspaceApi from '@/shared/api/groupsApi';
import * as knowledgeBasesApi from '@/shared/api/knowledgeBasesApi';
import { colors, spacing } from '@/shared/theme/tokens';
import {
  audioFixtures,
  groupFixture,
  knowledgeFixtures,
  sourceFixtures,
} from '@/test/workspaceFixtures';

const mockOfferStarterTemplates = jest.fn();

jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));
jest.mock('@/shared/onboarding/StarterTourContext', () => ({
  useStarterTour: () => ({ offerStarterTemplates: mockOfferStarterTemplates }),
  useStarterTourTarget: () => undefined,
}));
jest.mock('@/shared/api/groupsApi', () => ({
  createGroup: jest.fn(),
  getGroupTemplateExample: jest.fn(),
  listGroups: jest.fn(),
  listGroupAudioFiles: jest.fn(),
  listGroupKnowledgeBases: jest.fn(),
  listGroupDataSources: jest.fn(),
  replaceGroupKnowledgeBases: jest.fn(),
  replaceGroupDataSources: jest.fn(),
}));
jest.mock('@/shared/api/knowledgeBasesApi', () => ({
  listKnowledgeBases: jest.fn(),
}));
jest.mock('@/shared/api/dataSourcesApi', () => ({
  listDataSources: jest.fn(),
}));

const secondGroup = {
  ...groupFixture,
  id: '10000000-0000-4000-8000-000000000002',
  name: '客户体验组',
  updatedAt: '2026-08-20T10:00:00.000Z',
};
const templateExample = {
  templateKey: 'sales_call_review' as const,
  exampleVersion: 1,
  title: 'B2B 首次需求沟通示例',
  scenario: '销售首次沟通',
  playbackAvailable: false as const,
  roles: [{ id: 'sales', label: '销售' }],
  transcript: [
    {
      id: 's1',
      roleId: 'sales',
      roleLabel: '销售',
      emotion: '平静',
      startMs: 0,
      endMs: 1000,
      text: '你好',
    },
  ],
  summarySections: [{ title: '摘要', body: '内容' }],
  analysisTags: [
    { kind: 'strength' as const, title: '有效', detail: '说明', evidenceSegmentIds: ['s1'] },
  ],
  recommendations: ['继续'],
  limitations: ['只读'],
};

async function renderGroup(props?: ComponentProps<typeof GroupScreen>) {
  const screen = render(<GroupScreen {...props} />);
  await waitFor(() => {
    expect(screen.getByTestId('group-display-title').props.children).toBe(groupFixture.name);
  });
  await waitFor(() => {
    expect(screen.queryByLabelText('正在加载分组音频')).toBeNull();
    expect(screen.queryByLabelText('正在加载关联知识库')).toBeNull();
    expect(screen.queryByLabelText('正在加载分组数据源')).toBeNull();
  });
  return screen;
}

async function finishDrawerClose() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 250));
  });
}

describe('GroupScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(workspaceApi.createGroup).mockResolvedValue(secondGroup);
    jest.mocked(workspaceApi.getGroupTemplateExample).mockResolvedValue(templateExample);
    jest.mocked(workspaceApi.listGroups).mockResolvedValue({ items: [groupFixture] });
    jest
      .mocked(workspaceApi.listGroupAudioFiles)
      .mockResolvedValue({ items: audioFixtures.slice(0, 5) });
    jest
      .mocked(workspaceApi.listGroupKnowledgeBases)
      .mockResolvedValue({ items: knowledgeFixtures });
    jest
      .mocked(workspaceApi.listGroupDataSources)
      .mockResolvedValue({ items: sourceFixtures.slice(0, 3) });
    jest
      .mocked(knowledgeBasesApi.listKnowledgeBases)
      .mockResolvedValue({ items: knowledgeFixtures });
    jest.mocked(dataSourcesApi.listDataSources).mockResolvedValue({ items: sourceFixtures });
    jest
      .mocked(workspaceApi.replaceGroupKnowledgeBases)
      .mockResolvedValue({ items: knowledgeFixtures });
    jest.mocked(workspaceApi.replaceGroupDataSources).mockResolvedValue({ items: sourceFixtures });
  });

  it('uses the special group title and inline icon sizing rules', async () => {
    const screen = await renderGroup();

    expect(StyleSheet.flatten(screen.getByText('产品研究组').props.style)).toEqual(
      expect.objectContaining({
        fontSize: 40,
        fontWeight: 'bold',
        lineHeight: 60,
      }),
    );
    expect(StyleSheet.flatten(screen.getByTestId('icon-hourglass-outline').props.style)).toEqual({
      height: 14,
      width: 14,
    });
    expect(StyleSheet.flatten(screen.getByTestId('group-top-bar').props.style)).toEqual(
      expect.objectContaining({
        paddingBottom: spacing.lg,
        paddingHorizontal: spacing.md,
        paddingTop: spacing.lg,
      }),
    );
    for (const label of ['菜单', '搜索', '分组设置']) {
      expect(StyleSheet.flatten(screen.getByLabelText(label).props.style)).toEqual(
        expect.objectContaining({ height: 44, width: 44 }),
      );
    }
    const cardStyle = StyleSheet.flatten(
      screen.getByLabelText('产品访谈分析，分析已完成').props.style,
    );
    expect(cardStyle).toEqual(
      expect.objectContaining({ backgroundColor: colors.card, padding: spacing.md }),
    );
    expect(cardStyle).not.toHaveProperty('shadowOpacity');
  });

  it('uses 16/24 typography for analysis, knowledge, and source names', async () => {
    const screen = await renderGroup();

    for (const title of ['产品访谈分析', '产品研究知识库', '团队文档空间']) {
      const titleNode = screen
        .getAllByText(title)
        .find((node) => StyleSheet.flatten(node.props.style)?.fontSize === 16);
      expect(titleNode).toBeTruthy();
      expect(StyleSheet.flatten(titleNode?.props.style)).toEqual(
        expect.objectContaining({ fontSize: 16, lineHeight: 24 }),
      );
    }
  });

  it('marks starter groups as editable templates in the page and drawer', async () => {
    jest.mocked(workspaceApi.listGroups).mockResolvedValue({
      items: [{ ...groupFixture, starterTemplateKey: 'sales_call_review' }],
    });
    const screen = await renderGroup();

    expect(screen.getByText('模板')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('菜单'));
    expect(screen.getAllByText('模板')).toHaveLength(2);
  });

  it('shows a read-only template example without changing the real audio count', async () => {
    const onOpenTemplateExample = jest.fn();
    jest.mocked(workspaceApi.listGroups).mockResolvedValue({
      items: [{ ...groupFixture, starterTemplateKey: 'sales_call_review' }],
    });
    const screen = await renderGroup({ onOpenTemplateExample });
    expect(await screen.findByText('B2B 首次需求沟通示例')).toBeTruthy();
    expect(screen.getByText('共 5 份音频')).toBeTruthy();
    fireEvent.press(screen.getByText('B2B 首次需求沟通示例'));
    expect(onOpenTemplateExample).toHaveBeenCalledWith(groupFixture.id);
  });

  it('keeps real audio visible when the template example request fails', async () => {
    jest.mocked(workspaceApi.listGroups).mockResolvedValue({
      items: [{ ...groupFixture, starterTemplateKey: 'sales_call_review' }],
    });
    jest.mocked(workspaceApi.getGroupTemplateExample).mockRejectedValue(new Error('示例暂不可用'));
    const screen = await renderGroup();
    expect(await screen.findByText('示例暂不可用')).toBeTruthy();
    expect(screen.getByText('共 5 份音频')).toBeTruthy();
    expect(screen.getByText('产品访谈分析')).toBeTruthy();
  });

  it('moves the group name beside the menu after each page scrolls', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000);
    const screen = await renderGroup();

    fireEvent.scroll(screen.getByTestId('group-audio-scroll'), {
      nativeEvent: { contentOffset: { x: 0, y: 40 } },
    });
    expect(screen.getByTestId('group-inline-title')).toBeTruthy();
    expect(screen.queryByTestId('group-display-title')).toBeNull();

    fireEvent(screen.getByTestId('group-audio-scroll'), 'momentumScrollEnd', {
      nativeEvent: { contentOffset: { x: 0, y: 0 } },
    });
    expect(screen.getByTestId('group-inline-title')).toBeTruthy();

    fireEvent.press(screen.getByRole('tab', { name: '关联知识库' }));
    expect(screen.getByTestId('group-display-title')).toBeTruthy();

    fireEvent.scroll(screen.getByTestId('group-knowledge-scroll'), {
      nativeEvent: { contentOffset: { x: 0, y: 40 } },
    });
    expect(screen.getByTestId('group-inline-title')).toBeTruthy();

    now.mockReturnValue(1_300);
    fireEvent(screen.getByTestId('group-knowledge-scroll'), 'scrollEndDrag', {
      nativeEvent: { contentOffset: { x: 0, y: 0 } },
    });
    expect(screen.getByTestId('group-display-title')).toBeTruthy();
    now.mockRestore();
  });

  it('keeps group tab labels close to their underline', async () => {
    const screen = await renderGroup();
    expect(StyleSheet.flatten(screen.getByText('音频分析').props.style)).toEqual(
      expect.objectContaining({ paddingBottom: 4 }),
    );
  });

  it('switches among the three group content tabs', async () => {
    const screen = await renderGroup();

    expect(screen.getByText('共 5 份音频')).toBeTruthy();

    fireEvent.press(screen.getByRole('tab', { name: '关联知识库' }));
    await waitFor(() => expect(screen.getByText('共关联 2 个知识库')).toBeTruthy());

    fireEvent.press(screen.getByText('连接数据源'));
    expect(screen.getByText('共连接 3 个数据源')).toBeTruthy();
  });

  it('links existing knowledge bases and data sources from empty tab states', async () => {
    jest.mocked(workspaceApi.listGroupKnowledgeBases).mockResolvedValue({ items: [] });
    jest.mocked(workspaceApi.listGroupDataSources).mockResolvedValue({ items: [] });
    jest
      .mocked(workspaceApi.replaceGroupKnowledgeBases)
      .mockResolvedValue({ items: [knowledgeFixtures[1]!] });
    jest
      .mocked(workspaceApi.replaceGroupDataSources)
      .mockResolvedValue({ items: [sourceFixtures[0]!] });
    const screen = await renderGroup();

    fireEvent.press(screen.getByRole('tab', { name: '关联知识库' }));
    fireEvent.press(screen.getByRole('button', { name: '关联知识库' }));
    await waitFor(() => expect(screen.getByText('团队文档空间')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('关联知识库：团队文档空间'));
    fireEvent.press(screen.getByLabelText('保存关联'));

    await waitFor(() =>
      expect(workspaceApi.replaceGroupKnowledgeBases).toHaveBeenCalledWith(groupFixture.id, {
        ids: [knowledgeFixtures[1]!.id],
      }),
    );
    expect(screen.getByText('共关联 1 个知识库')).toBeTruthy();

    fireEvent.press(screen.getByText('连接数据源'));
    fireEvent.press(screen.getByRole('button', { name: '关联数据源' }));
    await waitFor(() => expect(screen.getByText('团队录音空间')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('关联数据源：团队录音空间'));
    fireEvent.press(screen.getByLabelText('保存关联'));

    await waitFor(() =>
      expect(workspaceApi.replaceGroupDataSources).toHaveBeenCalledWith(groupFixture.id, {
        ids: [sourceFixtures[0]!.id],
      }),
    );
    expect(screen.getByText('共连接 1 个数据源')).toBeTruthy();
  });

  it('retries candidate loading and explains when no resources are available', async () => {
    jest.mocked(workspaceApi.listGroupKnowledgeBases).mockResolvedValue({ items: [] });
    jest.mocked(workspaceApi.listGroupDataSources).mockResolvedValue({ items: [] });
    jest
      .mocked(knowledgeBasesApi.listKnowledgeBases)
      .mockRejectedValueOnce(new Error('知识库目录暂时不可用'))
      .mockResolvedValueOnce({ items: [] });
    const screen = await renderGroup();

    fireEvent.press(screen.getByRole('tab', { name: '关联知识库' }));
    fireEvent.press(screen.getByRole('button', { name: '关联知识库' }));
    await waitFor(() => expect(screen.getByText('知识库目录暂时不可用')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('重试'));

    await waitFor(() => expect(screen.getByText('暂无可关联知识库')).toBeTruthy());
    expect(screen.getByLabelText('保存关联')).toBeDisabled();
  });

  it('retries a failed association save without losing the selected resources', async () => {
    jest.mocked(workspaceApi.listGroupKnowledgeBases).mockResolvedValue({ items: [] });
    jest.mocked(workspaceApi.listGroupDataSources).mockResolvedValue({ items: [] });
    jest
      .mocked(workspaceApi.replaceGroupKnowledgeBases)
      .mockRejectedValueOnce(new Error('关联保存暂时失败'))
      .mockResolvedValueOnce({ items: [knowledgeFixtures[0]!] });
    const screen = await renderGroup();

    fireEvent.press(screen.getByRole('tab', { name: '关联知识库' }));
    fireEvent.press(screen.getByRole('button', { name: '关联知识库' }));
    await waitFor(() => expect(screen.getByText('产品研究知识库')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('关联知识库：产品研究知识库'));
    fireEvent.press(screen.getByLabelText('保存关联'));

    await waitFor(() => expect(screen.getByText('关联保存暂时失败')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('重试'));

    await waitFor(() => expect(workspaceApi.replaceGroupKnowledgeBases).toHaveBeenCalledTimes(2));
    expect(screen.getByText('共关联 1 个知识库')).toBeTruthy();
  });

  it('does not show link actions for search or filter empty results', async () => {
    const screen = await renderGroup();

    fireEvent.press(screen.getByLabelText('搜索'));
    fireEvent.changeText(screen.getByLabelText('输入搜索关键词'), '不存在的资源');
    fireEvent(screen.getByLabelText('输入搜索关键词'), 'submitEditing');
    fireEvent.press(screen.getByRole('tab', { name: '关联知识库' }));

    expect(screen.getAllByText('没有匹配“\u4e0d存在的资源”的内容')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: '关联知识库' })).toBeNull();

    fireEvent.press(screen.getByLabelText('搜索'));
    fireEvent.changeText(screen.getByLabelText('输入搜索关键词'), '');
    fireEvent(screen.getByLabelText('输入搜索关键词'), 'submitEditing');
    fireEvent.press(screen.getByLabelText('知识库排序筛选'));
    fireEvent.press(screen.getByRole('radio', { name: '空知识库' }));
    fireEvent.press(screen.getByLabelText('确认排序筛选'));

    expect(screen.getByText('没有符合当前文档筛选的知识库')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '关联知识库' })).toBeNull();
  });

  it('opens linked knowledge bases and connected data sources from their cards', async () => {
    const onOpenKnowledge = jest.fn();
    const onOpenSource = jest.fn();
    const screen = await renderGroup({ onOpenKnowledge, onOpenSource });

    fireEvent.press(screen.getByText('关联知识库'));
    fireEvent.press(screen.getByLabelText(`打开知识库：${knowledgeFixtures[0].name}`));
    expect(onOpenKnowledge).toHaveBeenCalledWith(knowledgeFixtures[0].id, groupFixture.id);

    fireEvent.press(screen.getByText('连接数据源'));
    fireEvent.press(screen.getByLabelText(`打开数据源：${sourceFixtures[0].name}`));
    expect(onOpenSource).toHaveBeenCalledWith(sourceFixtures[0].id, groupFixture.id);
  });

  it('synchronizes the selected group tab after a horizontal swipe', async () => {
    const screen = await renderGroup();

    fireEvent(screen.getByTestId('group-tab-pager'), 'momentumScrollEnd', {
      nativeEvent: { contentOffset: { x: 480, y: 0 } },
    });

    expect(screen.getByRole('tab', { name: '关联知识库' }).props.accessibilityState).toEqual({
      selected: true,
    });
  });

  it('opens the selected group settings from the drawer row action', async () => {
    const onOpenSettings = jest.fn();
    const screen = await renderGroup({ onOpenSettings });

    fireEvent.press(screen.getByLabelText('菜单'));
    fireEvent.press(screen.getByLabelText(`打开分组设置：${groupFixture.name}`));
    await finishDrawerClose();

    expect(onOpenSettings).toHaveBeenCalledWith(groupFixture.id);
  });

  it('keeps group settings in the header action', async () => {
    const onOpenSettings = jest.fn();
    const screen = await renderGroup({ onOpenSettings });

    fireEvent.press(screen.getByLabelText('分组设置'));

    expect(onOpenSettings).toHaveBeenCalledWith(groupFixture.id);
  });

  it('retries a failed group directory request', async () => {
    jest
      .mocked(workspaceApi.listGroups)
      .mockRejectedValueOnce(new Error('分组目录暂时不可用。'))
      .mockResolvedValueOnce({ items: [groupFixture] });
    const screen = render(<GroupScreen />);

    await waitFor(() => expect(screen.getByText('重新加载分组')).toBeTruthy());
    fireEvent.press(screen.getByText('重新加载分组'));

    await waitFor(() =>
      expect(screen.getByTestId('group-display-title').props.children).toBe(groupFixture.name),
    );
    expect(workspaceApi.listGroups).toHaveBeenCalledTimes(2);
  });

  it('opens only completed audio records', async () => {
    const onOpenAudio = jest.fn();
    const screen = await renderGroup({ onOpenAudio });

    fireEvent.press(screen.getByLabelText('产品访谈分析，分析已完成'));

    expect(onOpenAudio).toHaveBeenCalledWith(audioFixtures[0].id, groupFixture.id);
    expect(screen.queryByLabelText('功能概念验证，分析已完成')).toBeNull();
  });

  it('creates a group from the inline drawer form and selects it', async () => {
    const screen = await renderGroup();

    fireEvent.press(screen.getByLabelText('菜单'));
    fireEvent.press(screen.getByLabelText('添加分组'));
    fireEvent.changeText(screen.getByLabelText('分组名称'), '  客户体验组  ');
    fireEvent(screen.getByLabelText('分组名称'), 'submitEditing');

    await waitFor(() =>
      expect(workspaceApi.createGroup).toHaveBeenCalledWith({ name: '客户体验组' }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('group-display-title').props.children).toBe('客户体验组'),
    );
    expect(workspaceApi.listGroupAudioFiles).toHaveBeenCalledWith(secondGroup.id);
    await finishDrawerClose();
    expect(screen.queryByLabelText('分组名称')).toBeNull();
  });

  it('keeps drawer and search placeholders vertically centered', async () => {
    const screen = await renderGroup();

    fireEvent.press(screen.getByLabelText('菜单'));
    fireEvent.press(screen.getByLabelText('添加分组'));
    expect(StyleSheet.flatten(screen.getByLabelText('分组名称').props.style)).toEqual(
      expect.objectContaining({
        height: 44,
        includeFontPadding: false,
        paddingVertical: 0,
        textAlignVertical: 'center',
      }),
    );

    fireEvent.press(screen.getByLabelText('关闭分组侧栏遮罩'));
    expect(screen.getByLabelText('关闭分组侧栏遮罩')).toBeTruthy();
    await finishDrawerClose();
    expect(screen.queryByLabelText('关闭分组侧栏遮罩')).toBeNull();
    fireEvent.press(screen.getByLabelText('搜索'));
    expect(StyleSheet.flatten(screen.getByLabelText('输入搜索关键词').props.style)).toEqual(
      expect.objectContaining({
        height: 46,
        includeFontPadding: false,
        paddingVertical: 0,
        textAlignVertical: 'center',
      }),
    );
  });

  it('keeps the inline create form open with an actionable server error', async () => {
    jest.mocked(workspaceApi.createGroup).mockRejectedValue(new Error('服务暂时不可用。'));
    const screen = await renderGroup();

    fireEvent.press(screen.getByLabelText('菜单'));
    fireEvent.press(screen.getByLabelText('添加分组'));
    fireEvent.changeText(screen.getByLabelText('分组名称'), '客户体验组');
    fireEvent.press(screen.getByText('创建'));

    await waitFor(() => expect(screen.getByText('服务暂时不可用。')).toBeTruthy());
    expect(screen.getByLabelText('分组名称')).toBeTruthy();
  });

  it('marks the current drawer row and synchronizes a selected group to routing', async () => {
    jest.mocked(workspaceApi.listGroups).mockResolvedValue({ items: [groupFixture, secondGroup] });
    const onGroupChange = jest.fn();
    const screen = await renderGroup({ onGroupChange });

    fireEvent.press(screen.getByLabelText('菜单'));
    expect(
      screen.getByLabelText(`切换到分组：${groupFixture.name}`).props.accessibilityState,
    ).toEqual({ selected: true });
    fireEvent.press(screen.getByLabelText(`切换到分组：${secondGroup.name}`));

    await waitFor(() => expect(onGroupChange).toHaveBeenCalledWith(secondGroup.id));
    expect(screen.getByTestId('group-display-title').props.children).toBe(secondGroup.name);
  });

  it('applies one submitted search across all tabs and closes the search sheet', async () => {
    const screen = await renderGroup();

    fireEvent.press(screen.getByLabelText('搜索'));
    fireEvent.changeText(screen.getByLabelText('输入搜索关键词'), '产品');
    fireEvent(screen.getByLabelText('输入搜索关键词'), 'submitEditing');

    expect(screen.queryByLabelText('输入搜索关键词')).toBeNull();
    expect(screen.getByText('共 1 份音频')).toBeTruthy();

    fireEvent.press(screen.getByText('关联知识库'));
    expect(screen.getByText('共关联 1 个知识库')).toBeTruthy();

    fireEvent.press(screen.getByText('连接数据源'));
    expect(screen.getByText('共连接 0 个数据源')).toBeTruthy();
    expect(screen.getByText('没有匹配“产品”的内容')).toBeTruthy();
  });

  it('applies multiple audio status filters and resets them when switching groups', async () => {
    jest.mocked(workspaceApi.listGroups).mockResolvedValue({ items: [groupFixture, secondGroup] });
    jest.mocked(workspaceApi.listGroupAudioFiles).mockResolvedValue({ items: audioFixtures });
    const screen = await renderGroup();

    fireEvent.press(screen.getByLabelText('音频排序筛选'));
    fireEvent.press(screen.getByText('已完成'));
    fireEvent.press(screen.getByText('失败'));
    fireEvent.press(screen.getByLabelText('确认排序筛选'));
    expect(screen.getByText('共 4 份音频')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('菜单'));
    fireEvent.press(screen.getByLabelText(`切换到分组：${secondGroup.name}`));

    await waitFor(() => expect(screen.getByText('共 9 份音频')).toBeTruthy());
    expect(screen.getByRole('tab', { name: '音频分析' }).props.accessibilityState).toEqual({
      selected: true,
    });
  });

  it('adapts sorting and filtering controls to knowledge and source tabs', async () => {
    const emptyKnowledge = {
      ...knowledgeFixtures[1],
      id: 'b0000000-0000-4000-8000-000000000099',
      name: '空知识库',
      documentCount: 0,
    };
    jest
      .mocked(workspaceApi.listGroupKnowledgeBases)
      .mockResolvedValue({ items: [knowledgeFixtures[0], emptyKnowledge] });
    const screen = await renderGroup();

    fireEvent.press(screen.getByText('关联知识库'));
    fireEvent.press(screen.getByLabelText('知识库排序筛选'));
    fireEvent.press(screen.getByRole('radio', { name: '空知识库' }));
    fireEvent.press(screen.getByLabelText('确认排序筛选'));
    expect(screen.getByText('共关联 1 个知识库')).toBeTruthy();
    expect(screen.getByText('空知识库')).toBeTruthy();
    expect(screen.queryByText(knowledgeFixtures[0].name)).toBeNull();

    fireEvent.press(screen.getByText('连接数据源'));
    fireEvent.press(screen.getByLabelText('数据源排序筛选'));
    fireEvent.press(screen.getByText('云端'));
    fireEvent.press(screen.getByLabelText('确认排序筛选'));
    expect(screen.getByText('共连接 2 个数据源')).toBeTruthy();
  });

  it('synchronizes a user-selected tab to routing', async () => {
    const onTabChange = jest.fn();
    const screen = await renderGroup({ onTabChange });

    fireEvent.press(screen.getByText('连接数据源'));

    expect(onTabChange).toHaveBeenCalledWith('sources');
  });

  it('ignores a stale resource response after rapid group switching', async () => {
    const staleAudio = {
      ...audioFixtures[0],
      id: '40000000-0000-4000-8000-999999999999',
      title: '过期分组响应',
    };
    let resolveSecond: ((value: { items: typeof audioFixtures }) => void) | undefined;
    jest.mocked(workspaceApi.listGroups).mockResolvedValue({ items: [groupFixture, secondGroup] });
    jest.mocked(workspaceApi.listGroupAudioFiles).mockImplementation((id) => {
      if (id === secondGroup.id) {
        return new Promise((resolve) => {
          resolveSecond = resolve;
        });
      }
      return Promise.resolve({ items: audioFixtures.slice(0, 5) });
    });
    const screen = await renderGroup();

    fireEvent.press(screen.getByLabelText('菜单'));
    fireEvent.press(screen.getByLabelText(`切换到分组：${secondGroup.name}`));
    await finishDrawerClose();
    expect(screen.queryByLabelText('关闭分组侧栏遮罩')).toBeNull();
    fireEvent.press(screen.getByLabelText('菜单'));
    fireEvent.press(screen.getByLabelText(`切换到分组：${groupFixture.name}`));
    await waitFor(() => expect(screen.getByText('共 5 份音频')).toBeTruthy());

    await act(async () => {
      resolveSecond?.({ items: [staleAudio] });
    });
    expect(screen.queryByText('过期分组响应')).toBeNull();
    expect(screen.getByText('共 5 份音频')).toBeTruthy();
  });

  it('honors a routed initial group and opens its knowledge tab', async () => {
    jest.mocked(workspaceApi.listGroups).mockResolvedValue({ items: [groupFixture, secondGroup] });
    const screen = render(<GroupScreen initialGroupId={secondGroup.id} initialTab="knowledge" />);

    await waitFor(() =>
      expect(screen.getByTestId('group-display-title').props.children).toBe(secondGroup.name),
    );
    expect(screen.getByRole('tab', { name: '关联知识库' }).props.accessibilityState).toEqual({
      selected: true,
    });
    expect(workspaceApi.listGroupKnowledgeBases).toHaveBeenCalledWith(secondGroup.id);
  });

  it('reacts to external group and tab route parameter changes', async () => {
    jest.mocked(workspaceApi.listGroups).mockResolvedValue({ items: [groupFixture, secondGroup] });
    const screen = render(<GroupScreen initialGroupId={groupFixture.id} initialTab="audio" />);
    await waitFor(() =>
      expect(screen.getByTestId('group-display-title').props.children).toBe(groupFixture.name),
    );

    screen.rerender(<GroupScreen initialGroupId={secondGroup.id} initialTab="sources" />);

    await waitFor(() =>
      expect(screen.getByTestId('group-display-title').props.children).toBe(secondGroup.name),
    );
    expect(screen.getByRole('tab', { name: '连接数据源' }).props.accessibilityState).toEqual({
      selected: true,
    });
  });
});
