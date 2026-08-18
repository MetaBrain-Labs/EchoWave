/** Cross-platform visual tokens governed by the repository design specification. */
export const textColors = {
  primary: '#000000',
  secondary: '#5A6472',
  tertiary: '#A3A3A3',
} as const;

export const colors = {
  background: '#f5f5f5',
  canvas: '#fafafa',
  card: '#ffffff',
  divider: '#e8e8e8',
  ink: textColors.primary,
  muted: textColors.tertiary,
  secondary: textColors.secondary,
  success: '#18b88b',
  successSurface: '#e1f3ed',
  white: '#ffffff',
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
  analysisDisplay: { fontSize: 32, lineHeight: 48 },
  heading1: { fontSize: 18, lineHeight: 26 },
  heading2: { fontSize: 16, lineHeight: 24 },
  heading3: { fontSize: 14, lineHeight: 20 },
  heading4: { fontSize: 12, lineHeight: 18 },
  heading5: { fontSize: 10, lineHeight: 14 },
  body: { fontSize: 14, lineHeight: 20 },
  description: { fontSize: 12, lineHeight: 18 },
  label: { fontSize: 10, lineHeight: 14 },
} as const;
