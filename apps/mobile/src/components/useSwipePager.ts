/** Synchronizes same-level tabs with a horizontally swipeable React Native pager. */
import { useEffect, useRef } from 'react';
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  ScrollView,
  useWindowDimensions,
} from 'react-native';

const desktopCanvasWidth = 480;

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
