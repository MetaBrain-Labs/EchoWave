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
import { parseResourceOrigin } from '@/shared/navigation/resourceOrigin';
import { backOrReplace } from '@/shared/navigation/routeBack';
import { firstRouteParam } from '@/shared/navigation/routeParams';

/** 读取分析 ID 并渲染对应分析详情页面。 */
export default function AnalysisDetailRoute() {
  const router = useRouter();
  const {
    groupId,
    id,
    origin: originParam,
    originGroupId,
    returnSourceId,
  } = useLocalSearchParams<{
    groupId?: string | string[];
    id?: string | string[];
    origin?: string | string[];
    originGroupId?: string | string[];
    returnSourceId?: string | string[];
  }>();
  const detailId = firstRouteParam(id);
  const sourceId = firstRouteParam(returnSourceId);
  const analysisGroupId = firstRouteParam(groupId);
  const sourceOriginGroupId = firstRouteParam(originGroupId);
  const origin = parseResourceOrigin(originParam);
  const goBack = () => {
    if (sourceId) {
      backOrReplace(router, {
        pathname: '/sources/[sourceId]',
        params: {
          sourceId,
          origin: origin ?? 'source-list',
          ...(sourceOriginGroupId ? { groupId: sourceOriginGroupId } : {}),
        },
      });
    } else if (analysisGroupId) {
      backOrReplace(router, {
        pathname: '/',
        params: { groupId: analysisGroupId, tab: 'audio' },
      });
    } else {
      backOrReplace(router, '/');
    }
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
