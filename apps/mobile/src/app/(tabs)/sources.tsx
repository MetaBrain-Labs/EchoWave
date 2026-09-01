/**
 * 数据源标签路由入口。
 *
 * 将底部数据源标签连接到数据源列表，并把详情导航隔离在 Expo Router 页面中。
 *
 * Responsibilities:
 * - 渲染数据源目录。
 * - 将数据源选择转换为详情路由。
 *
 * Notes:
 * - 展示数据由 data-sources feature 通过共享工作区 API 获取。
 */
import { useCallback, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';

import { DataSourceListScreen } from '@/features/data-sources/screens/DataSourceListScreen';

/** 连接数据源目录与数据源详情导航。 */
export default function DataSourcesRoute() {
  const router = useRouter();
  const [refreshKey, setRefreshKey] = useState(0);
  const firstFocus = useRef(true);

  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
      } else {
        setRefreshKey((value) => value + 1);
      }
    }, []),
  );

  return (
    <DataSourceListScreen
      key={refreshKey}
      onOpenSource={(sourceId) => {
        router.push({
          pathname: '/sources/[sourceId]',
          params: { sourceId, origin: 'source-list' },
        });
      }}
    />
  );
}
