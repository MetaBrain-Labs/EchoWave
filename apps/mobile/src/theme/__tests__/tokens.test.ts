import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '../tokens';

describe('text color tokens', () => {
  it('uses the exact semantic text colors from DESIGN.md', () => {
    expect(textColors).toEqual({
      primary: '#000000',
      secondary: '#5A6472',
      tertiary: '#A3A3A3',
    });

    expect(colors.ink).toBe(textColors.primary);
    expect(colors.secondary).toBe(textColors.secondary);
    expect(colors.muted).toBe(textColors.tertiary);
  });
});

describe('layout and typography tokens', () => {
  it('uses the bundled font family names', () => {
    expect(fontFamilies).toEqual({
      kai: 'LXGWWenKaiLite-Regular',
      sans: 'SourceHanSansCN-Regular',
      sansBold: 'SourceHanSansCN-Bold',
    });
  });

  it('uses four-pixel spacing increments and the approved radius values', () => {
    expect(Object.values(spacing).every((value) => value % 4 === 0)).toBe(true);
    expect(spacing.base).toBe(12);
    expect(radii).toEqual({ default: 4, round: 999 });
  });

  it('matches every typography role from DESIGN.md', () => {
    expect(typography).toEqual({
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
    });
  });
});
