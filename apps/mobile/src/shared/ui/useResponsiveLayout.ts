/**
 * 跨平台响应式布局判断。
 *
 * 统一区分桌面布局断点和 Web 原生能力，避免浏览器窗口宽度误判设备功能。
 *
 * Responsibilities:
 * - 暴露桌面断点与视口宽度。
 * - 让组件跟随窗口缩放及时切换布局。
 *
 * Notes:
 * - 原生平台始终采用移动布局。
 */
import { Platform, useWindowDimensions } from 'react-native';
import { getResponsiveLayout } from '@/shared/ui/layoutMetrics';

/** 返回 Web 视口达到桌面工作台断点时的布局标记。 */
export function useResponsiveLayout() {
  const { width } = useWindowDimensions();
  return {
    ...getResponsiveLayout(Platform.OS, width),
    width,
  };
}
