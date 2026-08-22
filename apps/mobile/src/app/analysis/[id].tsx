/**
 * 分析详情路由入口。
 *
 * 读取分析记录路由参数并连接展示页面与返回导航。
 *
 * Responsibilities:
 * - 校验并传递分析记录 ID。
 * - 隔离 Expo Router 导航调用。
 *
 * Notes:
 * - 分析内容由 feature 通过共享工作区 API 读取。
 */
import { useLocalSearchParams, useRouter } from 'expo-router';

import { AnalysisDetailScreen } from '@/features/analysis-detail/AnalysisDetailScreen';
import { useNavigationLoading } from '@/shared/navigation/NavigationLoadingProvider';
import { firstRouteParam } from '@/shared/navigation/routeParams';

/** 读取分析 ID 并渲染对应分析详情页面。 */
export default function AnalysisDetailRoute() {
  const router = useRouter();
  const { runWithLoading } = useNavigationLoading();
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const detailId = firstRouteParam(id);
  const goBack = () => {
    void runWithLoading(() => {
      router.replace('/');
    });
  };

  return <AnalysisDetailScreen detailId={detailId} onBack={goBack} />;
}
