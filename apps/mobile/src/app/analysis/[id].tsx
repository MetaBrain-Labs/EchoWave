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
import { firstRouteParam } from '@/shared/navigation/routeParams';

/** 读取分析 ID 并渲染对应分析详情页面。 */
export default function AnalysisDetailRoute() {
  const router = useRouter();
  const { groupId, id, returnSourceId } = useLocalSearchParams<{
    groupId?: string | string[];
    id?: string | string[];
    returnSourceId?: string | string[];
  }>();
  const detailId = firstRouteParam(id);
  const sourceId = firstRouteParam(returnSourceId);
  const analysisGroupId = firstRouteParam(groupId);
  const goBack = () => {
    if (sourceId) router.replace({ pathname: '/sources/[sourceId]', params: { sourceId } });
    else router.replace('/');
  };

  return (
    <AnalysisDetailScreen
      detailId={detailId}
      groupId={analysisGroupId || undefined}
      onBack={goBack}
      onOpenCitation={(knowledgeBaseId, documentId, chunkId) =>
        router.push({
          pathname: '/knowledge/[knowledgeId]/files/[fileId]/blocks/[blockId]',
          params: {
            knowledgeId: knowledgeBaseId,
            fileId: documentId,
            blockId: chunkId,
            returnTo: 'analysis',
          },
        })
      }
    />
  );
}
