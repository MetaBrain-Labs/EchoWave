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
import { Platform } from 'react-native';

export const textColors = {
  primary: '#101828',
  secondary: '#667085',
  tertiary: '#98A2B3',
} as const;

export const colors = {
  primary: '#1677FF',
  primaryHover: '#4096FF',
  primaryActive: '#0958D9',
  primarySurface: '#EAF3FF',
  primaryBorder: '#BFDBFE',
  background: '#F7F9FC',
  // 环境背景仅用于 Web；原生画布和内容表面保持不透明。
  canvas: Platform.OS === 'web' ? 'rgba(247, 249, 253, 0.32)' : '#F7F9FC',
  surfaceSecondary: '#F5F7FA',
  card: '#FFFFFF',
  divider: '#E4E7EC',
  borderSoft: '#EEF1F5',
  ink: textColors.primary,
  muted: textColors.tertiary,
  secondary: textColors.secondary,
  success: '#12B886',
  successSurface: '#E6F7F1',
  warning: '#F79009',
  warningSurface: '#FFF4E5',
  danger: '#D92D20',
  dangerSurface: '#FEF3F2',
  ai: '#7A5AF8',
  aiSurface: '#F4F0FF',
  white: '#FFFFFF',
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
  default: 12,
  input: 12,
  button: 12,
  card: 16,
  large: 20,
  sheet: 24,
  round: 999,
} as const;

export const fontFamilies = {
  kai: 'LXGWWenKaiLite-Regular',
  sans: 'SourceHanSansCN-Regular',
  sansBold: 'SourceHanSansCN-Bold',
} as const;

export const typography = {
  groupName: { fontSize: 24, lineHeight: 32 },
  contentDisplay: { fontSize: 32, lineHeight: 40 },
  pageTitle: { fontSize: 24, lineHeight: 32 },
  heroTitle: { fontSize: 32, lineHeight: 40 },
  sectionTitle: { fontSize: 18, lineHeight: 26 },
  cardTitle: { fontSize: 16, lineHeight: 24 },
  heading1: { fontSize: 18, lineHeight: 26 },
  heading2: { fontSize: 16, lineHeight: 24 },
  heading3: { fontSize: 14, lineHeight: 20 },
  heading4: { fontSize: 12, lineHeight: 18 },
  heading5: { fontSize: 10, lineHeight: 14 },
  body: { fontSize: 14, lineHeight: 22 },
  description: { fontSize: 12, lineHeight: 18 },
  label: { fontSize: 10, lineHeight: 14 },
} as const;
