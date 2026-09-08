/**
 * 通用分页标签测试。
 *
 * 验证分页标签的选中状态、交互回调和可选 E2E 标识。
 *
 * Responsibilities:
 * - 锁定标签点击与当前值同步行为。
 * - 确保调用方可为重复标签提供稳定 testID。
 */
import { fireEvent, render } from '@testing-library/react-native';

import { PageTabs } from '../PageTabs';

describe('PageTabs', () => {
  it('exposes prefixed test IDs without changing tab labels', () => {
    const onChange = jest.fn();
    const screen = render(
      <PageTabs
        activeTab="overview"
        onChange={onChange}
        tabs={[
          { key: 'overview', label: '概览' },
          { key: 'audio', label: '音频文件' },
        ]}
        testIDPrefix="data-source-tab"
      />,
    );

    expect(screen.getByTestId('data-source-tab-overview').props.accessibilityState).toEqual({
      selected: true,
    });
    fireEvent.press(screen.getByTestId('data-source-tab-audio'));
    expect(onChange).toHaveBeenCalledWith('audio');
    expect(screen.getByText('音频文件')).toBeTruthy();
  });
});
