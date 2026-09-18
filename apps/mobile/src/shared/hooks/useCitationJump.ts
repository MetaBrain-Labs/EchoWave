/**
 * 引用标记跳转与高亮协调器。
 *
 * 让答案正文中的 [n] 标记把滚动容器定位到对应引用卡片，并在跳转后临时高亮该卡片。
 *
 * Responsibilities:
 * - 记住引用列表在滚动内容中的基准偏移。
 * - 记录待跳转/高亮的引用编号，并在跳转后定时清除高亮。
 * - 在引用列表展开完成后按测量偏移滚动容器。
 *
 * Notes:
 * - 页面只负责把容器 ref、列表布局和卡片偏移交给本 hook。
 * - 展开引用列表会先改变内容高度，因此滚动前需要等一帧。
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { ScrollView } from 'react-native';

const SCROLL_HEADROOM = 160;
const HIGHLIGHT_DURATION_MS = 2_400;

/** 为答案正文标记提供跳转、滚动与高亮状态。 */
export function useCitationJump(scrollRef: RefObject<ScrollView | null>) {
  const listYRef = useRef(0);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const frame = useRef<ReturnType<typeof requestAnimationFrame> | undefined>(undefined);
  const [highlightedNumber, setHighlightedNumber] = useState<number>();

  useEffect(
    () => () => {
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
      if (frame.current) cancelAnimationFrame(frame.current);
    },
    [],
  );

  /** 记录引用列表在滚动内容中的纵向位置。 */
  const setListOffset = useCallback((y: number) => {
    listYRef.current = y;
  }, []);

  /** 重新开始高亮计时，避免滚动过程或重复点击让高亮提前消失。 */
  const restartHighlight = useCallback(() => {
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(
      () => setHighlightedNumber(undefined),
      HIGHLIGHT_DURATION_MS,
    );
  }, []);

  /** 点击正文标记：立即高亮目标卡片，滚动由引用列表上报偏移后执行。 */
  const openCitation = useCallback(
    (number: number) => {
      setHighlightedNumber(number);
      restartHighlight();
    },
    [restartHighlight],
  );

  /** 引用列表完成布局后回调，按卡片偏移滚动容器。 */
  const onCitationScrollToOffset = useCallback(
    (offset: number) => {
      // 展开引用列表会先改变内容高度，等一帧再滚动才能落到卡片真实位置。
      frame.current = requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({
          animated: true,
          y: Math.max(0, listYRef.current + offset - SCROLL_HEADROOM),
        });
      });
      // 滚动结束后重新计时，保证高亮不会在滚动动画途中提前消失。
      restartHighlight();
    },
    [restartHighlight, scrollRef],
  );

  return {
    highlightedNumber,
    onCitationScrollToOffset,
    openCitation,
    setListOffset,
  };
}
