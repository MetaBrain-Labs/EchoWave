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
import { parseResourceOrigin } from '@/shared/navigation/resourceOrigin';
import { backOrReplace } from '@/shared/navigation/routeBack';
import { firstRouteParam } from '@/shared/navigation/routeParams';

/** 渲染路由参数指定的数据源详情。 */
export default function DataSourceDetailRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    sourceId?: string | string[];
    groupId?: string | string[];
    origin?: string | string[];
  }>();
  const groupId = firstRouteParam(params.groupId);
  const origin = parseResourceOrigin(params.origin);
  const sourceId = firstRouteParam(params.sourceId);
  const goBack = () => {
    if (origin === 'group' && groupId) {
      backOrReplace(router, { pathname: '/', params: { groupId, tab: 'sources' } });
    } else {
      backOrReplace(router, '/(tabs)/sources');
    }
  };

  return (
    <DataSourceDetailScreen
      onBack={goBack}
      onArchived={goBack}
      onOpenAudio={(id, analysisGroupId) =>
        router.push({
          pathname: '/analysis/[id]',
          params: {
            id,
            groupId: analysisGroupId,
            origin: origin ?? 'source-list',
            ...(origin === 'group' && groupId ? { originGroupId: groupId } : {}),
            returnSourceId: sourceId,
          },
        })
      }
      onSwitchGroup={(groupId) =>
        router.replace({ pathname: '/', params: { groupId, tab: 'sources' } })
      }
      sourceId={sourceId}
      preferredGroupId={groupId || undefined}
    />
  );
}
