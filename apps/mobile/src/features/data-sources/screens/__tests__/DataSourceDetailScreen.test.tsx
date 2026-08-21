/**
 * 数据源详情页面测试。
 *
 * 验证概览吸顶结构、四页导航、状态表达、固定操作和缺失数据反馈。
 *
 * Responsibilities:
 * - 覆盖数据源详情原型的主要可观察交互。
 *
 * Notes:
 * - 不执行真实上传、转写、播放或关联操作。
 */
import { fireEvent, render, within } from '@testing-library/react-native';
import { Alert, StyleSheet } from 'react-native';

import { DataSourceDetailScreen } from '../DataSourceDetailScreen';

describe('DataSourceDetailScreen', () => {
  it('renders the overview hero and keeps its tabs sticky after the hero', () => {
    const screen = render(
      <DataSourceDetailScreen onBack={jest.fn()} sourceId="source-team-docs" />,
    );

    expect(screen.getAllByText('团队录音空间')).toHaveLength(2);
    expect(screen.getByText('数据源详情')).toBeTruthy();
    expect(screen.getByText('最近上传　2026-08-20 16:32:00')).toBeTruthy();
    expect(screen.getByTestId('data-source-overview-scroll').props.stickyHeaderIndices).toEqual([1]);
    expect(
      screen.getAllByRole('tab', { name: '概览' })[0]?.props.accessibilityState,
    ).toEqual({ selected: true });
  });

  it('switches tabs by press and horizontal swipe and updates fixed actions', () => {
    const screen = render(
      <DataSourceDetailScreen onBack={jest.fn()} sourceId="source-team-docs" />,
    );

    fireEvent.press(screen.getAllByRole('tab', { name: '关联分组' })[0]!);
    expect(
      within(screen.getByTestId('data-source-fixed-actions')).getByText('关联新分组'),
    ).toBeTruthy();

    fireEvent(screen.getByTestId('data-source-detail-pager'), 'momentumScrollEnd', {
      nativeEvent: { contentOffset: { x: 480, y: 0 } },
    });

    expect(
      screen.getAllByRole('tab', { name: '音频文件' })[0]?.props.accessibilityState,
    ).toEqual({ selected: true });
    const actions = within(screen.getByTestId('data-source-fixed-actions'));
    expect(actions.getByText('全部转写')).toBeTruthy();
    expect(actions.getByText('上传音频')).toBeTruthy();
  });

  it('shows all audio and upload failure states without forbidden text colors', () => {
    const screen = render(
      <DataSourceDetailScreen onBack={jest.fn()} sourceId="source-team-docs" />,
    );

    expect(screen.getAllByText('上传中').length).toBeGreaterThan(0);
    expect(screen.getAllByText('待转写').length).toBeGreaterThan(0);
    expect(screen.getAllByText('上传失败').length).toBeGreaterThan(0);
    expect(screen.getAllByText('转写失败').length).toBeGreaterThan(0);

    for (const label of ['上传失败', '转写失败']) {
      for (const node of screen.getAllByText(label)) {
        expect(['#000000', '#5A6472', '#A3A3A3']).toContain(
          StyleSheet.flatten(node.props.style)?.color,
        );
      }
    }
  });

  it('provides feedback for retry actions instead of changing mock state', () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const screen = render(
      <DataSourceDetailScreen onBack={jest.fn()} sourceId="source-team-docs" />,
    );

    fireEvent.press(screen.getByLabelText('重新上传：09:15:26'));

    expect(alert).toHaveBeenCalledWith('功能建设中', '重新上传将在后续版本开放。');
    alert.mockRestore();
  });

  it('renders an actionable empty state for an unknown source id', () => {
    const onBack = jest.fn();
    const screen = render(<DataSourceDetailScreen onBack={onBack} sourceId="missing" />);

    expect(screen.getByText('未找到数据源')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('返回'));
    expect(onBack).toHaveBeenCalled();
  });
});
