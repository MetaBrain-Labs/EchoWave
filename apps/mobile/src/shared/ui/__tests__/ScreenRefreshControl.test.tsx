/**
 * 页面刷新控件测试。
 *
 * 验证 ScrollView 注入的容器样式与页面内容会透传给原生 RefreshControl。
 *
 * Responsibilities:
 * - 防止统一刷新包装层吞掉滚动页面内容。
 *
 * Notes:
 * - 测试直接复现 ScrollView cloneElement 时传入的 children 和 style。
 */
import { StyleSheet, Text } from 'react-native';

import { ScreenRefreshControl } from '../ScreenRefreshControl';

describe('ScreenRefreshControl', () => {
  it('forwards the ScrollView child and cloned container style', () => {
    const content = <Text testID="server-data-content">已加载服务端数据</Text>;
    const control = ScreenRefreshControl({
      children: content,
      onRefresh: jest.fn(),
      refreshing: false,
      style: styles.container,
    });

    expect(control.props.children).toBe(content);
    expect(StyleSheet.flatten(control.props.style)).toEqual(expect.objectContaining({ flex: 1 }));
  });
});

const styles = StyleSheet.create({
  container: { flex: 1 },
});
