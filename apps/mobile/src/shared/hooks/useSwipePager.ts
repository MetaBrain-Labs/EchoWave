/**
 * 同级页面滑动 Hook。
 *
 * 同步标签选择、页面宽度和横向 ScrollView 偏移，为多个 feature 提供统一的滑动分页行为。
 *
 * Responsibilities:
 * - 根据布局宽度计算并控制分页位置。
 * - 将手势结束状态同步回活动标签。
 *
 * Notes:
 * - 仅管理 UI 导航偏好，不持久化业务数据。
 */
import { useEffect, useRef } from 'react';
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  ScrollView,
  useWindowDimensions,
} from 'react-native';

const desktopCanvasWidth = 480;

/** 同步标签选择与横向分页 ScrollView，并返回页面宽度和事件处理器。 */
export function useSwipePager<Tab extends string>({
  activeTab,
  onTabChange,
  tabs,
}: {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  tabs: readonly Tab[];
}) {
  const pagerRef = useRef<ScrollView>(null);
  const { width } = useWindowDimensions();
  const pageWidth = Math.min(width, desktopCanvasWidth);
  const activeIndex = tabs.indexOf(activeTab);
  const previousPageWidth = useRef(pageWidth);

  useEffect(() => {
    if (previousPageWidth.current !== pageWidth) {
      pagerRef.current?.scrollTo?.({
        animated: false,
        x: Math.max(activeIndex, 0) * pageWidth,
        y: 0,
      });
      previousPageWidth.current = pageWidth;
    }
  }, [activeIndex, pageWidth]);

  const selectTab = (tab: Tab) => {
    const index = tabs.indexOf(tab);
    if (index < 0) {
      return;
    }

    pagerRef.current?.scrollTo?.({ animated: true, x: index * pageWidth, y: 0 });
    onTabChange(tab);
  };

  const handleMomentumScrollEnd = (
    event: NativeSyntheticEvent<NativeScrollEvent>,
  ) => {
    const index = Math.round(event.nativeEvent.contentOffset.x / pageWidth);
    const tab = tabs[index];

    if (tab !== undefined && tab !== activeTab) {
      onTabChange(tab);
    }
  };

  return {
    handleMomentumScrollEnd,
    pageWidth,
    pagerRef,
    selectTab,
  };
}
