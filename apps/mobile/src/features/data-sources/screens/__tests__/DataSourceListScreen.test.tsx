/**
 * 数据源列表页面测试。
 *
 * 验证数据源摘要、来源图标、占位反馈和详情导航行为。
 *
 * Responsibilities:
 * - 覆盖用户可观察的数据源目录交互。
 *
 * Notes:
 * - 服务端响应通过工作区传输适配器 mock 注入。
 */
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { DataSourceListScreen } from '../DataSourceListScreen';
import * as workspaceApi from '@/shared/api/dataSourcesApi';
import { colors, radii, spacing } from '@/shared/theme/tokens';
import { dataSourceDetailFixture, sourceFixtures } from '@/test/workspaceFixtures';

jest.mock('@/shared/api/dataSourcesApi', () => ({
  createDataSource: jest.fn(),
  listDataSources: jest.fn(),
}));

async function renderList(onOpenSource = jest.fn()) {
  const screen = render(<DataSourceListScreen onOpenSource={onOpenSource} />);
  await waitFor(() => expect(screen.queryByLabelText('正在加载数据源')).toBeNull());
  return screen;
}

describe('DataSourceListScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(workspaceApi.listDataSources).mockResolvedValue({ items: sourceFixtures });
    jest.mocked(workspaceApi.createDataSource).mockResolvedValue({
      ...dataSourceDetailFixture,
      id: '20000000-0000-4000-8000-000000000099',
    });
  });

  it('renders source summaries with the required typography and location icons', async () => {
    const screen = await renderList();

    expect(screen.getByRole('header', { name: '数据源' })).toBeTruthy();
    expect(screen.getByText('团队录音空间')).toBeTruthy();
    expect(screen.getByText('接入 3 个分组 · HTTPS API / team-audio')).toBeTruthy();
    expect(screen.getAllByTestId('icon-folder-outline')).toHaveLength(2);
    expect(screen.getAllByTestId('icon-cloud-outline')).toHaveLength(2);
    expect(StyleSheet.flatten(screen.getByText('团队录音空间').props.style)).toEqual(
      expect.objectContaining({ fontSize: 16, lineHeight: 24, fontWeight: 'bold' }),
    );
    expect(StyleSheet.flatten(screen.getByTestId('top-level-page-header').props.style)).toEqual(
      expect.objectContaining({
        paddingBottom: spacing.lg,
        paddingHorizontal: spacing.md,
        paddingTop: spacing.lg,
      }),
    );
    expect(
      screen
        .getByTestId('data-source-list-scroll')
        .findAllByProps({ testID: 'top-level-page-header' }),
    ).toHaveLength(0);
    expect(StyleSheet.flatten(screen.getByLabelText('新建数据源').props.style)).toEqual(
      expect.objectContaining({
        backgroundColor: colors.card,
        borderColor: colors.divider,
        borderRadius: radii.default,
        minHeight: 44,
      }),
    );
    const cardStyle = StyleSheet.flatten(
      screen.getByLabelText('打开数据源：团队录音空间').props.style,
    );
    expect(cardStyle).toEqual(
      expect.objectContaining({
        backgroundColor: colors.card,
        borderColor: colors.divider,
        borderRadius: radii.default,
        padding: spacing.md,
      }),
    );
    expect(cardStyle).not.toHaveProperty('shadowOpacity');
  });

  it('opens the selected source using its stable identifier', async () => {
    const onOpenSource = jest.fn();
    const screen = await renderList(onOpenSource);

    fireEvent.press(screen.getByLabelText('打开数据源：团队录音空间'));

    expect(onOpenSource).toHaveBeenCalledWith(sourceFixtures[0].id);
  });

  it('searches source metadata and creates a trimmed local data source', async () => {
    const onOpenSource = jest.fn();
    const screen = await renderList(onOpenSource);

    fireEvent.press(screen.getByLabelText('搜索数据源'));
    fireEvent.changeText(screen.getByLabelText('输入数据源搜索关键词'), '  云端  ');
    fireEvent(screen.getByLabelText('输入数据源搜索关键词'), 'submitEditing');
    expect(screen.getByText('用户研究云盘')).toBeTruthy();
    expect(screen.queryByText('团队录音空间')).toBeNull();

    fireEvent.press(screen.getByLabelText('新建数据源'));
    fireEvent.changeText(screen.getByLabelText('数据源名称'), '  本地访谈  ');
    fireEvent.changeText(screen.getByLabelText('数据源描述'), '  用户声音  ');
    fireEvent.press(screen.getByText('确认'));

    await waitFor(() =>
      expect(workspaceApi.createDataSource).toHaveBeenCalledWith({
        name: '本地访谈',
        description: '用户声音',
      }),
    );
    expect(onOpenSource).toHaveBeenCalledWith('20000000-0000-4000-8000-000000000099');
  });

  it('shows a distinct empty state when no source matches', async () => {
    const screen = await renderList();

    fireEvent.press(screen.getByLabelText('搜索数据源'));
    fireEvent.changeText(screen.getByLabelText('输入数据源搜索关键词'), '不存在');
    fireEvent(screen.getByLabelText('输入数据源搜索关键词'), 'submitEditing');

    expect(screen.getByText('没有匹配“不存在”的数据源。')).toBeTruthy();
    expect(screen.queryByText('暂无数据源。')).toBeNull();
  });

  it('shows an API failure and reloads the list on request', async () => {
    jest
      .mocked(workspaceApi.listDataSources)
      .mockRejectedValueOnce(new Error('数据源服务暂时不可用。'))
      .mockResolvedValueOnce({ items: sourceFixtures });
    const screen = await renderList();

    expect(screen.getByRole('alert')).toHaveTextContent('数据源服务暂时不可用。');
    fireEvent.press(screen.getByText('重新加载'));

    await waitFor(() => expect(screen.getByText('团队录音空间')).toBeTruthy());
    expect(workspaceApi.listDataSources).toHaveBeenCalledTimes(2);
  });
});
