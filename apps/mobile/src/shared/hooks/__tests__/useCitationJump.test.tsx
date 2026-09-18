/**
 * 引用标记跳转协调器测试。
 *
 * 验证滚动偏移换算、引用列表展开后的延迟滚动以及高亮的定时清除。
 *
 * Responsibilities:
 * - 锁定列表偏移、卡片偏移与顶部留白的换算关系。
 * - 锁定滚动发生在下一帧且高亮会自动过期。
 */
import { act, renderHook } from '@testing-library/react-native';

import { useCitationJump } from '../useCitationJump';

function createScrollRef() {
  const scrollTo = jest.fn();
  return {
    scrollTo,
    ref: { current: { scrollTo } } as unknown as Parameters<typeof useCitationJump>[0],
  };
}

describe('useCitationJump', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('scrolls to the measured card offset in the next frame', () => {
    const { ref, scrollTo } = createScrollRef();
    const { result } = renderHook(() => useCitationJump(ref));

    act(() => result.current.setListOffset(300));
    act(() => result.current.onCitationScrollToOffset(4 * 48));
    act(() => jest.advanceTimersByTime(16));

    // 卡片偏移 192 + 列表偏移 300 - 160 顶部留白。
    expect(scrollTo).toHaveBeenCalledWith({ animated: true, y: 332 });
  });

  it('never scrolls to a negative offset', () => {
    const { ref, scrollTo } = createScrollRef();
    const { result } = renderHook(() => useCitationJump(ref));

    act(() => result.current.setListOffset(20));
    act(() => result.current.onCitationScrollToOffset(0));
    act(() => jest.advanceTimersByTime(16));

    expect(scrollTo).toHaveBeenCalledWith({ animated: true, y: 0 });
  });

  it('highlights the marker target and clears it after the highlight window', () => {
    const { ref } = createScrollRef();
    const { result } = renderHook(() => useCitationJump(ref));

    expect(result.current.highlightedNumber).toBeUndefined();
    act(() => result.current.openCitation(5));
    expect(result.current.highlightedNumber).toBe(5);

    act(() => jest.advanceTimersByTime(2_400));
    expect(result.current.highlightedNumber).toBeUndefined();
  });
});
