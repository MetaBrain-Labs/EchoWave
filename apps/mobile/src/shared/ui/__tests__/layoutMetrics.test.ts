/**
 * 响应式布局断点测试。
 *
 * 锁定移动画布、桌面工作台与宽屏详情的视口切换边界。
 *
 * Responsibilities:
 * - 验证 960px 桌面工作台断点。
 * - 验证 1280px 宽屏分栏断点。
 * - 验证原生平台不会因窗口宽度切换到 Web 桌面壳层。
 *
 * Notes:
 * - 直接覆盖生产布局判定，避免用第二套测试常量模拟断点。
 */
import { getResponsiveLayout } from '../layoutMetrics';

describe('getResponsiveLayout', () => {
  it('keeps the mobile canvas below 960px and enables the desktop shell at 960px', () => {
    expect(getResponsiveLayout('web', 959)).toEqual({ desktop: false, wideDesktop: false });
    expect(getResponsiveLayout('web', 960)).toEqual({ desktop: true, wideDesktop: false });
  });

  it('enables wide detail layouts at 1280px while keeping 1279px in the regular desktop layout', () => {
    expect(getResponsiveLayout('web', 1279)).toEqual({ desktop: true, wideDesktop: false });
    expect(getResponsiveLayout('web', 1280)).toEqual({ desktop: true, wideDesktop: true });
  });

  it('keeps native platforms in mobile layout at desktop-sized widths', () => {
    expect(getResponsiveLayout('ios', 1440)).toEqual({ desktop: false, wideDesktop: false });
    expect(getResponsiveLayout('android', 1440)).toEqual({ desktop: false, wideDesktop: false });
  });
});
