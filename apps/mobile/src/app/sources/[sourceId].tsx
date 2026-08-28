/**
 * 数据源详情路由入口。
 *
 * 规范化动态路由参数，并把返回行为注入数据源详情页面。
 *
 * Responsibilities:
 * - 读取单个数据源标识。
 * - 连接详情页面与 Expo Router 返回导航。
 *
 * Notes:
 * - 页面组件不直接依赖路由实现。
 */
import { useLocalSearchParams, useRouter } from 'expo-router';

import { DataSourceDetailScreen } from '@/features/data-sources/screens/DataSourceDetailScreen';
import { firstRouteParam } from '@/shared/navigation/routeParams';

/** 渲染路由参数指定的数据源详情。 */
export default function DataSourceDetailRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    sourceId?: string | string[];
    groupId?: string | string[];
  }>();
  const groupId = firstRouteParam(params.groupId);

  return (
    <DataSourceDetailScreen
      onBack={() => router.back()}
      onArchived={() => router.replace('/(tabs)/sources')}
      onOpenAudio={(id, analysisGroupId) =>
        router.push({
          pathname: '/analysis/[id]',
          params: {
            id,
            groupId: analysisGroupId,
            returnSourceId: firstRouteParam(params.sourceId),
          },
        })
      }
      onSwitchGroup={(groupId) =>
        router.replace({ pathname: '/', params: { groupId, tab: 'sources' } })
      }
      sourceId={firstRouteParam(params.sourceId)}
      preferredGroupId={groupId || undefined}
    />
  );
}
