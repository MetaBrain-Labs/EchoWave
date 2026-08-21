/**
 * 数据源列表页面测试。
 *
 * 验证数据源摘要、来源图标、占位反馈和详情导航行为。
 *
 * Responsibilities:
 * - 覆盖用户可观察的数据源目录交互。
 *
 * Notes:
 * - 使用 feature 内的只读 presentation mock。
 */
import { fireEvent, render } from '@testing-library/react-native';
import { Alert, StyleSheet } from 'react-native';

import { DataSourceListScreen } from '../DataSourceListScreen';

describe('DataSourceListScreen', () => {
  it('renders source summaries with the required typography and location icons', () => {
    const screen = render(<DataSourceListScreen onOpenSource={jest.fn()} />);

    expect(screen.getByRole('header', { name: '数据源' })).toBeTruthy();
    expect(screen.getByText('团队录音空间')).toBeTruthy();
    expect(screen.getByText('接入 3 个分组 · HTTPS API / team-audio')).toBeTruthy();
    expect(screen.getAllByTestId('icon-folder-outline')).toHaveLength(2);
    expect(screen.getAllByTestId('icon-cloud-outline')).toHaveLength(2);
    expect(StyleSheet.flatten(screen.getByText('团队录音空间').props.style)).toEqual(
      expect.objectContaining({ fontSize: 16, lineHeight: 24, fontWeight: 'bold' }),
    );
  });

  it('opens the selected source using its stable identifier', () => {
    const onOpenSource = jest.fn();
    const screen = render(<DataSourceListScreen onOpenSource={onOpenSource} />);

    fireEvent.press(screen.getByLabelText('打开数据源：团队录音空间'));

    expect(onOpenSource).toHaveBeenCalledWith('source-team-docs');
  });

  it('provides explicit feedback for search and create placeholders', () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const screen = render(<DataSourceListScreen onOpenSource={jest.fn()} />);

    fireEvent.press(screen.getByLabelText('搜索数据源'));
    fireEvent.press(screen.getByLabelText('新增数据源'));

    expect(alert).toHaveBeenNthCalledWith(1, '功能建设中', '数据源搜索将在后续版本开放。');
    expect(alert).toHaveBeenNthCalledWith(2, '功能建设中', '新增数据源将在后续版本开放。');
    alert.mockRestore();
  });
});
