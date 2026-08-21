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
import { fireEvent, render, waitFor } from '@testing-library/react-native';
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
  listGroups: jest.fn(),
  listGroupAudioFiles: jest.fn(),
  listGroupKnowledgeBases: jest.fn(),
  listGroupDataSources: jest.fn(),
}));

async function renderGroup(props?: ComponentProps<typeof GroupScreen>) {
  const screen = render(<GroupScreen {...props} />);
  await waitFor(() => {
    expect(screen.queryByLabelText('正在加载分组音频')).toBeNull();
    expect(screen.queryByLabelText('正在加载关联知识库')).toBeNull();
    expect(screen.queryByLabelText('正在加载分组数据源')).toBeNull();
  });
  return screen;
}

describe('GroupScreen', () => {
  beforeEach(() => {
    jest.mocked(workspaceApi.listGroups).mockResolvedValue({ items: [groupFixture] });
    jest.mocked(workspaceApi.listGroupAudioFiles).mockResolvedValue({ items: audioFixtures.slice(0, 5) });
    jest.mocked(workspaceApi.listGroupKnowledgeBases).mockResolvedValue({ items: knowledgeFixtures });
    jest.mocked(workspaceApi.listGroupDataSources).mockResolvedValue({ items: sourceFixtures.slice(0, 3) });
  });

  it('uses the special group title and inline icon sizing rules', async () => {
    const screen = await renderGroup();

    expect(
      StyleSheet.flatten(screen.getByText('产品研究组').props.style),
    ).toEqual(
      expect.objectContaining({
        fontSize: 40,
        fontWeight: 'bold',
        lineHeight: 60,
      }),
    );
    expect(
      StyleSheet.flatten(screen.getByTestId('icon-hourglass-outline').props.style),
    ).toEqual({ height: 14, width: 14 });
  });

  it('uses 16/24 typography for analysis, knowledge, and source names', async () => {
    const screen = await renderGroup();

    for (const title of ['产品访谈分析', '产品研究知识库', '团队文档空间']) {
      const titleNode = screen.getAllByText(title).find((node) =>
        StyleSheet.flatten(node.props.style)?.fontSize === 16,
      );
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

    expect(
      screen.getByRole('tab', { name: '关联知识库' }).props.accessibilityState,
    ).toEqual({ selected: true });
  });

  it('provides feedback for placeholder actions', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const screen = await renderGroup();

    fireEvent.press(screen.getByLabelText('搜索'));

    expect(alert).toHaveBeenCalledWith(
      '功能建设中',
      '搜索将在后续版本开放。',
    );
    alert.mockRestore();
  });

  it('opens only completed audio records', async () => {
    const onOpenAudio = jest.fn();
    const screen = await renderGroup({ onOpenAudio });

    fireEvent.press(
      screen.getByLabelText('产品访谈分析，分析已完成'),
    );

    expect(onOpenAudio).toHaveBeenCalledWith(audioFixtures[0].id);
    expect(screen.queryByLabelText('功能概念验证，分析已完成')).toBeNull();
  });
});
