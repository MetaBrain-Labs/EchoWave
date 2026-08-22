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
import { Alert, StyleSheet } from 'react-native';

import { GroupScreen } from '../GroupScreen';
import * as workspaceApi from '@/shared/api/workspaceApi';
import {
  audioFixtures,
  groupFixture,
  knowledgeFixtures,
  sourceFixtures,
} from '@/test/workspaceFixtures';

jest.mock('@/shared/api/workspaceApi', () => ({
  archiveGroup: jest.fn(),
  createGroup: jest.fn(),
  listGroups: jest.fn(),
  listGroupAudioFiles: jest.fn(),
  listGroupKnowledgeBases: jest.fn(),
  listGroupDataSources: jest.fn(),
}));

const secondGroup = {
  ...groupFixture,
  id: '10000000-0000-4000-8000-000000000002',
  name: '客户体验组',
  updatedAt: '2026-08-20T10:00:00.000Z',
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
    jest.mocked(workspaceApi.archiveGroup).mockResolvedValue(undefined);
    jest.mocked(workspaceApi.createGroup).mockResolvedValue(secondGroup);
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

    fireEvent.press(screen.getByText('关联知识库'));
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

    fireEvent.press(screen.getByText('关联知识库'));
    await waitFor(() => expect(screen.getByText('共关联 2 个知识库')).toBeTruthy());

    fireEvent.press(screen.getByText('连接数据源'));
    expect(screen.getByText('共连接 3 个数据源')).toBeTruthy();
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

  it('keeps feedback for the remaining header filter placeholder', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const screen = await renderGroup();

    fireEvent.press(screen.getByLabelText('设置筛选'));

    expect(alert).toHaveBeenCalledWith('功能建设中', '设置筛选将在后续版本开放。');
    alert.mockRestore();
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

    expect(onOpenAudio).toHaveBeenCalledWith(audioFixtures[0].id);
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

    fireEvent.press(screen.getByLabelText('关闭分组侧栏'));
    expect(screen.getByLabelText('关闭分组侧栏')).toBeTruthy();
    await finishDrawerClose();
    expect(screen.queryByLabelText('关闭分组侧栏')).toBeNull();
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

  it('archives the last group after confirmation and shows the supported empty state', async () => {
    const screen = await renderGroup();

    fireEvent.press(screen.getByLabelText('菜单'));
    fireEvent.press(screen.getByLabelText(`归档分组：${groupFixture.name}`));
    await waitFor(() =>
      expect(screen.getByText(/关联的知识库、数据源和音频不会被删除/)).toBeTruthy(),
    );
    fireEvent.press(screen.getByLabelText('确认归档分组'));

    await waitFor(() => expect(workspaceApi.archiveGroup).toHaveBeenCalledWith(groupFixture.id));
    await waitFor(() => expect(screen.getByText('还没有可用分组')).toBeTruthy());
    expect(screen.getByText('打开分组菜单')).toBeTruthy();
  });

  it('cancels archive confirmation without calling the server', async () => {
    const screen = await renderGroup();

    fireEvent.press(screen.getByLabelText('菜单'));
    fireEvent.press(screen.getByLabelText(`归档分组：${groupFixture.name}`));
    await waitFor(() => expect(screen.getByLabelText('确认归档分组')).toBeTruthy());
    fireEvent.press(screen.getByText('取消'));

    expect(workspaceApi.archiveGroup).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('确认归档分组')).toBeNull();
  });

  it('archives a non-selected group without changing the current group', async () => {
    jest.mocked(workspaceApi.listGroups).mockResolvedValue({ items: [groupFixture, secondGroup] });
    const screen = await renderGroup();

    fireEvent.press(screen.getByLabelText('菜单'));
    fireEvent.press(screen.getByLabelText(`归档分组：${secondGroup.name}`));
    await waitFor(() => expect(screen.getByLabelText('确认归档分组')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('确认归档分组'));

    await waitFor(() => expect(workspaceApi.archiveGroup).toHaveBeenCalledWith(secondGroup.id));
    expect(screen.getByTestId('group-display-title').props.children).toBe(groupFixture.name);
    expect(screen.queryByLabelText(`切换到分组：${secondGroup.name}`)).toBeNull();
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

    fireEvent.press(screen.getByLabelText('排序筛选'));
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
    expect(screen.queryByLabelText('关闭分组侧栏')).toBeNull();
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
});
