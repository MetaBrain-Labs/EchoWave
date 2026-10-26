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
import { useEffect, useRef, useState } from 'react';
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  ScrollView,
  useWindowDimensions,
  type LayoutChangeEvent,
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
  const activeIndex = tabs.indexOf(activeTab);
  const previousPageWidth = useRef(0);
  const previousActiveIndex = useRef(-1);
  const [measuredPageWidth, setMeasuredPageWidth] = useState(0);
  const pageWidth = measuredPageWidth || Math.min(width, desktopCanvasWidth);

  const handlePageLayout = (event: LayoutChangeEvent) => {
    const nextWidth = Math.round(event.nativeEvent.layout.width);
    if (nextWidth > 0 && nextWidth !== measuredPageWidth) setMeasuredPageWidth(nextWidth);
  };

  useEffect(() => {
    if (previousPageWidth.current !== pageWidth || previousActiveIndex.current !== activeIndex) {
      pagerRef.current?.scrollTo?.({
        animated: false,
        x: Math.max(activeIndex, 0) * pageWidth,
        y: 0,
      });
      previousPageWidth.current = pageWidth;
      previousActiveIndex.current = activeIndex;
    }
  }, [activeIndex, pageWidth]);

  const selectTab = (tab: Tab) => {
    const index = tabs.indexOf(tab);
    if (index < 0) {
      return;
    }

    previousActiveIndex.current = index;
    pagerRef.current?.scrollTo?.({ animated: true, x: index * pageWidth, y: 0 });
    onTabChange(tab);
  };

  const handleMomentumScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.round(event.nativeEvent.contentOffset.x / pageWidth);
    const tab = tabs[index];

    if (tab !== undefined && tab !== activeTab) {
      previousActiveIndex.current = index;
      onTabChange(tab);
    }
  };

  return {
    handlePageLayout,
    handleMomentumScrollEnd,
    pageWidth,
    pagerRef,
    selectTab,
  };
}
