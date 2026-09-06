/**
 * 多引导轻量上下文。
 *
 * 为业务页面提供目标注册和引导状态，不加载持久化或路由编排实现。
 *
 * Responsibilities:
 * - 定义 Provider 与页面之间的稳定接口。
 * - 为未包裹 Provider 的组件测试提供无副作用默认值。
 */
import type { GroupSummary, StarterTemplateKey } from '@echowave/contracts';
import { createContext, useCallback, useContext, type RefCallback } from 'react';
import type { View } from 'react-native';

import { GUIDE_IDS, type GuideId, type GuideStatus, type StarterTourTargetKey } from './guideRegistry';

type GuideStatuses = Record<GuideId, GuideStatus>;
const defaultStatuses = Object.fromEntries(GUIDE_IDS.map((id) => [id, 'not_started'])) as GuideStatuses;

export type StarterTourContextValue = {
  activeGuide: GuideId | null;
  activeStep: StarterTourTargetKey | null;
  offerStarterTemplates: (groups: readonly GroupSummary[]) => void;
  registerTarget: (key: StarterTourTargetKey, node: View | null, prepare?: () => void) => void;
  replay: () => void;
  startGuide: (id: GuideId) => void;
  statuses: GuideStatuses;
  templates: Partial<Record<StarterTemplateKey, string>>;
};

export const StarterTourContext = createContext<StarterTourContextValue>({
  activeGuide: null, activeStep: null, offerStarterTemplates: () => undefined,
  registerTarget: () => undefined, replay: () => undefined, startGuide: () => undefined,
  statuses: defaultStatuses, templates: {},
});

/** 读取多引导编排、状态和重播能力。 */
export function useStarterTour(): StarterTourContextValue { return useContext(StarterTourContext); }

/** 为可测量 View 生成稳定的引导目标 ref。 */
export function useStarterTourTarget(key: StarterTourTargetKey, prepare?: () => void): RefCallback<View> {
  const { registerTarget } = useStarterTour();
  return useCallback((node) => registerTarget(key, node, prepare), [key, prepare, registerTarget]);
}
