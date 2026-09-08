/**
 * 引导几何测试。
 *
 * 验证边缘、超宽、滚动后窗口外目标和箭头位置不会越界。
 */
import { clampSpotlight, placeTourCard } from '../guideRegistry';

describe('tour geometry', () => {
  it('clamps targets at every window edge and supports oversized targets', () => {
    expect(clampSpotlight({ x: -20, y: -10, width: 500, height: 900 }, 360, 800)).toEqual({
      left: 0,
      top: 0,
      width: 360,
      height: 800,
    });
    expect(clampSpotlight({ x: 340, y: 780, width: 40, height: 40 }, 360, 800)).toEqual({
      left: 333,
      top: 773,
      width: 27,
      height: 27,
    });
  });

  it('drops a target that is outside the viewport after scrolling', () => {
    expect(clampSpotlight({ x: 0, y: 900, width: 100, height: 40 }, 360, 800)).toBeNull();
  });

  it('keeps the card and arrow inside left, right, top and bottom bounds', () => {
    for (const spotlight of [
      { left: 0, top: 0, width: 40, height: 40 },
      { left: 330, top: 760, width: 30, height: 40 },
      { left: 0, top: 350, width: 360, height: 80 },
    ]) {
      const result = placeTourCard(spotlight, 360, 800, 328, 220);
      expect(result.left).toBeGreaterThanOrEqual(16);
      expect(result.left + 328).toBeLessThanOrEqual(344);
      expect(result.top).toBeGreaterThanOrEqual(16);
      expect(result.top + 220).toBeLessThanOrEqual(784);
      expect(result.arrowLeft).toBeGreaterThanOrEqual(14);
      expect(result.arrowLeft).toBeLessThanOrEqual(294);
    }
  });
});
