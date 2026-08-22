/**
 * 状态栏背景条。
 *
 * 在 iOS 透明状态栏与 Android edge-to-edge 模式下，状态栏区域显示的是背后最顶层视图的背景。
 * 本组件在根布局中渲染一条高度等于顶部安全区 inset 的绝对定位背景，把状态栏条带统一为
 * colors.background，同时不改变页面正文背景与状态栏图标颜色。
 *
 * Responsibilities:
 * - 用 colors.background 填充状态栏条带区域。
 * - 保持触摸事件穿透，不影响页面交互。
 *
 * Notes:
 * - Web 与无状态栏场景（顶部 inset 为 0）不渲染，避免引入空层。
 * - 必须渲染在 SafeAreaProvider 之内，inset 变化会触发重渲染。
 */
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '@/shared/theme/tokens';

/** 渲染覆盖状态栏条带区域的背景层，供根布局统一着色。 */
export function StatusBarBackdrop() {
  const insets = useSafeAreaInsets();

  // Web 与无状态栏设备无顶部 inset，无需渲染背景条。
  if (insets.top <= 0) {
    return null;
  }

  return (
    <View pointerEvents="none" style={[styles.backdrop, { height: insets.top }]} />
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: colors.background,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 10,
  },
});
