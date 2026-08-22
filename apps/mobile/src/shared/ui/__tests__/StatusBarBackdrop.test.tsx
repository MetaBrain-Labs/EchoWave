/**
 * 状态栏背景条测试。
 *
 * 验证背景条只在存在顶部安全区 inset 时渲染，并以 colors.background 填充且不拦截触摸。
 *
 * Responsibilities:
 * - 覆盖顶部 inset 存在与缺失两种渲染行为。
 *
 * Notes:
 * - 通过 SafeAreaProvider 的 initialMetrics 注入 inset，不依赖真实设备测量。
 */
import { render } from '@testing-library/react-native';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { colors } from '@/shared/theme/tokens';
import { StatusBarBackdrop } from '../StatusBarBackdrop';

function flatten(style: unknown): Record<string, unknown> {
  const list = Array.isArray(style) ? style : [style];
  return Object.assign({}, ...list.filter(Boolean).map((entry) => StyleSheet.flatten(entry)));
}

/** 在渲染树中找出高度等于顶部 inset 的背景条视图。 */
function findBackdrop(screen: ReturnType<typeof render>, height: number) {
  return screen.UNSAFE_queryAllByType(View).find((view) => {
    const style = flatten(view.props.style);
    return style.height === height && style.backgroundColor === colors.background;
  });
}

describe('StatusBarBackdrop', () => {
  it('渲染高度等于顶部 inset 的背景条', () => {
    const screen = render(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 47, right: 0, bottom: 34, left: 0 },
        }}
      >
        <StatusBarBackdrop />
      </SafeAreaProvider>,
    );

    const backdrop = findBackdrop(screen, 47);
    expect(backdrop).toBeDefined();
    expect(flatten(backdrop?.props.style)).toMatchObject({
      backgroundColor: colors.background,
      position: 'absolute',
      top: 0,
    });
    expect(backdrop?.props.pointerEvents).toBe('none');
  });

  it('顶部 inset 为 0 时不渲染背景条', () => {
    const screen = render(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 0, right: 0, bottom: 0, left: 0 },
        }}
      >
        <StatusBarBackdrop />
      </SafeAreaProvider>,
    );

    expect(findBackdrop(screen, 0)).toBeUndefined();
  });
});
