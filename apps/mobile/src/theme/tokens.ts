/** Cross-platform visual tokens derived from the supplied grayscale sketches. */
export const colors = {
  background: '#f5f5f5',
  canvas: '#fafafa',
  card: '#ffffff',
  divider: '#e8e8e8',
  ink: '#0a0a0a',
  muted: '#a0a4aa',
  secondary: '#626d7b',
  success: '#18b88b',
  successSurface: '#e1f3ed',
  white: '#ffffff',
} as const;

export const spacing = {
  xs: 6,
  sm: 10,
  md: 16,
  lg: 22,
  xl: 30,
  xxl: 42,
} as const;

export const radii = {
  sm: 8,
  md: 14,
  lg: 22,
  round: 999,
} as const;

export const typeScale = {
  caption: 13,
  body: 16,
  cardTitle: 21,
  section: 18,
  tab: 16,
  display: 48,
} as const;
