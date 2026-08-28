/**
 * 分组标签路由入口。
 *
 * 将分组主页面与分析详情路由连接，保持页面组件不依赖 Expo Router 实现细节。
 *
 * Responsibilities:
 * - 渲染分组工作区。
 * - 把分析记录选择转换为路由跳转。
 *
 * Notes:
 * - 分组数据请求与状态由 feature 层负责。
 */
import { useLocalSearchParams, useRouter } from 'expo-router';

import { GroupScreen } from '@/features/group/GroupScreen';
import { useNavigationLoading } from '@/shared/navigation/NavigationLoadingProvider';
import { firstRouteParam } from '@/shared/navigation/routeParams';

/** 连接分组页面与分析详情导航。 */
export default function GroupRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ groupId?: string | string[]; tab?: string | string[] }>();
  const { runWithLoading } = useNavigationLoading();
  const initialGroupId = firstRouteParam(params.groupId) || undefined;
  const routedTab = firstRouteParam(params.tab);
  const initialTab = routedTab === 'knowledge' || routedTab === 'sources' ? routedTab : undefined;

  return (
    <GroupScreen
      initialGroupId={initialGroupId}
      initialTab={initialTab}
      onOpenAudio={(id, groupId) => {
        void runWithLoading(() =>
          router.push({ pathname: '/analysis/[id]', params: { id, groupId } }),
        );
      }}
      onOpenKnowledge={(knowledgeId) => {
        void runWithLoading(() =>
          router.push({
            pathname: '/knowledge/[knowledgeId]',
            params: { knowledgeId },
          }),
        );
      }}
      onOpenSource={(sourceId, groupId) => {
        void runWithLoading(() =>
          router.push({
            pathname: '/sources/[sourceId]',
            params: { sourceId, groupId },
          }),
        );
      }}
      onOpenSettings={(groupId) => {
        void runWithLoading(() =>
          router.push({ pathname: '/groups/[groupId]/settings', params: { groupId } }),
        );
      }}
    />
  );
}
