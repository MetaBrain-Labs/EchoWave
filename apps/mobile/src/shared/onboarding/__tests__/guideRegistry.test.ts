/**
 * 引导几何测试。
 *
 * 验证边缘、超宽、滚动后窗口外目标和箭头位置不会越界。
 */
import {
  GUIDE_IDS,
  GUIDE_REGISTRY,
  clampSpotlight,
  localizeGuideRegistry,
  placeTourCard,
  windowRectToLocal,
} from '../guideRegistry';
import { en, zhCN } from '@/shared/i18n/translations';

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

  it('converts window coordinates into the overlay root coordinate system', () => {
    expect(
      windowRectToLocal(
        { x: 520, y: 180, width: 120, height: 44 },
        { x: 480, y: 96, width: 480, height: 800 },
      ),
    ).toEqual({ x: 40, y: 84, width: 120, height: 44 });
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

describe('guide copy and target alignment', () => {
  it('binds the reported captions to the settings button and group selector', () => {
    const basic = localizeGuideRegistry((key) => zhCN[key]).basic;
    expect(basic.steps.find((step) => step.title === '按目标调整')?.target).toBe('group-settings');
    expect(basic.steps.find((step) => step.title === '选择模板分组')?.target).toBe('create-group');
    expect(basic.steps.find((step) => step.target === 'group-tabs')?.title).toBe(
      '按页面标签完成工作流',
    );
  });

  it.each(GUIDE_IDS)('covers every %s step with target-keyed Chinese and English copy', (id) => {
    for (const catalog of [zhCN, en]) {
      const translate = jest.fn((key: keyof typeof zhCN) => catalog[key]);
      const localized = localizeGuideRegistry(translate)[id];
      const identities = GUIDE_REGISTRY[id].steps.map((step) => step.target ?? step.route);
      expect(new Set(identities).size).toBe(identities.length);
      for (const [index, step] of localized.steps.entries()) {
        expect(step.target).toBe(GUIDE_REGISTRY[id].steps[index].target);
        expect(step.route).toBe(GUIDE_REGISTRY[id].steps[index].route);
        expect(step.title).toBeTruthy();
        expect(step.body).toBeTruthy();
      }
      for (const [key] of translate.mock.calls) {
        expect(catalog[key]).toBeDefined();
        expect(key).not.toMatch(/^guide\.[^.]+\.\d+\./);
      }
    }
    const localized = localizeGuideRegistry((key) => zhCN[key])[id];
    expect(localized.steps).toEqual(GUIDE_REGISTRY[id].steps);
  });

  it('keeps copy attached to its target after steps are reordered', () => {
    const original = GUIDE_REGISTRY.basic;
    try {
      GUIDE_REGISTRY.basic = { ...original, steps: [...original.steps].reverse() };
      expect(localizeGuideRegistry((key) => zhCN[key]).basic.steps).toEqual(
        [...original.steps].reverse(),
      );
    } finally {
      GUIDE_REGISTRY.basic = original;
    }
  });
});
