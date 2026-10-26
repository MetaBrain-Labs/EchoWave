/**
 * 应用级响应布局尺寸。
 *
 * 为 Web 桌面工作区、移动画布和分组侧栏提供单一宽度来源。
 *
 * Responsibilities:
 * - 统一桌面断点与固定导航尺寸。
 *
 * Notes:
 * - 这些值只描述布局，不决定平台能力。
 */
export const DESKTOP_LAYOUT_BREAKPOINT = 960;
export const WIDE_DESKTOP_LAYOUT_BREAKPOINT = 1280;
export const MOBILE_CANVAS_MAX_WIDTH = 480;
export const DESKTOP_NAVIGATION_WIDTH = 224;
export const GROUP_NAVIGATION_WIDTH = 248;
export const DESKTOP_DETAIL_CONTENT_MAX_WIDTH = 1280;

/** 根据平台和视口宽度生成桌面与宽屏布局标记。 */
export function getResponsiveLayout(platform: string, width: number) {
  const web = platform === 'web';

  return {
    desktop: web && width >= DESKTOP_LAYOUT_BREAKPOINT,
    wideDesktop: web && width >= WIDE_DESKTOP_LAYOUT_BREAKPOINT,
  };
}
