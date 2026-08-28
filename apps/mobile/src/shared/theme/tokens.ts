/**
 * 跨平台视觉 token。
 *
 * 集中 EchoWave 的颜色、字体、间距、圆角与文字层级，作为 React Native 样式的单一视觉来源。
 *
 * Responsibilities:
 * - 导出可复用的设计 token。
 * - 保持 iOS、Android 与 Web 的视觉语义一致。
 *
 * Notes:
 * - 页面不得复制同义的硬编码 token。
 */
export const textColors = {
  primary: '#000000',
  secondary: '#5A6472',
  tertiary: '#A3A3A3',
} as const;

export const colors = {
  background: '#f9f9f9',
  canvas: '#f9f9f9',
  card: '#ffffff',
  divider: '#e8e8e8',
  ink: textColors.primary,
  muted: textColors.tertiary,
  secondary: textColors.secondary,
  success: '#18b88b',
  successSurface: '#e1f3ed',
  danger: '#ff3131',
  white: '#ffffff',
  black: '#171717',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  base: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 40,
} as const;

export const radii = {
  default: 4,
  round: 999,
} as const;

export const fontFamilies = {
  kai: 'LXGWWenKaiLite-Regular',
  sans: 'SourceHanSansCN-Regular',
  sansBold: 'SourceHanSansCN-Bold',
} as const;

export const typography = {
  groupName: { fontSize: 40, lineHeight: 60 },
  contentDisplay: { fontSize: 32, lineHeight: 48 },
  heading1: { fontSize: 18, lineHeight: 26 },
  heading2: { fontSize: 16, lineHeight: 24 },
  heading3: { fontSize: 14, lineHeight: 20 },
  heading4: { fontSize: 12, lineHeight: 18 },
  heading5: { fontSize: 10, lineHeight: 14 },
  body: { fontSize: 14, lineHeight: 20 },
  description: { fontSize: 12, lineHeight: 18 },
  label: { fontSize: 10, lineHeight: 14 },
} as const;
