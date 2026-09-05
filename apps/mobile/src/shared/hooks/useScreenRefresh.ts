/**
 * 服务端数据页面刷新协调器。
 *
 * 统一管理手动下拉刷新和页面重新获得焦点后的静默刷新，并合并同一页面上的并发请求。
 *
 * Responsibilities:
 * - 仅在用户手动刷新期间展示刷新指示器。
 * - 跳过首次焦点回调，避免与页面初次加载重复请求。
 *
 * Notes:
 * - 数据合并、草稿保护和错误呈现仍由各业务页面负责。
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

/** 为页面提供手动刷新状态和重新获得焦点后的静默刷新。 */
export function useScreenRefresh(refresh: () => Promise<void>) {
  const refreshRef = useRef(refresh);
  const inFlightRef = useRef<Promise<void> | undefined>(undefined);
  const firstFocusRef = useRef(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  const run = useCallback(async (manual: boolean) => {
    if (manual) setRefreshing(true);
    try {
      if (!inFlightRef.current) {
        const request = Promise.resolve(refreshRef.current());
        const tracked = request.finally(() => {
          if (inFlightRef.current === tracked) inFlightRef.current = undefined;
        });
        inFlightRef.current = tracked;
      }
      await inFlightRef.current;
    } finally {
      if (manual) setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (firstFocusRef.current) {
        firstFocusRef.current = false;
      } else {
        void run(false).catch(() => undefined);
      }
      return undefined;
    }, [run]),
  );

  return {
    refreshing,
    onRefresh: useCallback(() => void run(true).catch(() => undefined), [run]),
  };
}
