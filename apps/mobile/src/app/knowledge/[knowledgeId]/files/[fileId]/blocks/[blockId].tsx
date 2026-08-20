/**
 * 文档块详情路由入口。
 *
 * 连接知识库、文档和文档块参数，并处理相邻块与原文定位导航。
 *
 * Responsibilities:
 * - 渲染指定文档块。
 * - 保持相邻块导航参数完整。
 *
 * Notes:
 * - 不在路由层缓存文档正文。
 */
import { useLocalSearchParams, useRouter } from 'expo-router';

import { BlockDetailScreen } from '@/features/knowledge/screens/BlockDetailScreen';
import { useNavigationLoading } from '@/shared/navigation/NavigationLoadingProvider';
import { firstRouteParam } from '@/shared/navigation/routeParams';

/** 渲染指定文档块并保留完整来源层级参数。 */
export default function BlockDetailRoute() {
  const router = useRouter();
  const { runWithLoading } = useNavigationLoading();
  const params = useLocalSearchParams<{
    blockId?: string | string[];
    fileId?: string | string[];
    knowledgeId?: string | string[];
    returnTo?: string | string[];
  }>();
  const knowledgeId = firstRouteParam(params.knowledgeId);
  const documentId = firstRouteParam(params.fileId);
  const blockId = firstRouteParam(params.blockId);
  const returnsToQuery = firstRouteParam(params.returnTo) === 'knowledge-query';
  const fileRoute = {
    pathname: '/knowledge/[knowledgeId]/files/[fileId]' as const,
    params: { fileId: documentId, knowledgeId },
  };
  const goBack = () => {
    void runWithLoading(() => {
      if (returnsToQuery && router.canGoBack()) {
        router.back();
      } else {
        router.replace(fileRoute);
      }
    });
  };

  return (
    <BlockDetailScreen
      blockId={blockId}
      documentId={documentId}
      knowledgeId={knowledgeId}
      onBack={goBack}
      onLocateOriginal={(targetBlockId) => {
        void runWithLoading(() =>
          router.replace({
            pathname: fileRoute.pathname,
            params: {
              ...fileRoute.params,
              block: targetBlockId,
              tab: 'original',
              ...(returnsToQuery ? { returnTo: 'knowledge-query' } : {}),
            },
          }),
        );
      }}
      onNavigateBlock={(nextBlockId) => {
        void runWithLoading(() =>
          router.replace({
            pathname: '/knowledge/[knowledgeId]/files/[fileId]/blocks/[blockId]',
            params: {
              blockId: nextBlockId,
              fileId: documentId,
              knowledgeId,
              ...(returnsToQuery ? { returnTo: 'knowledge-query' } : {}),
            },
          }),
        );
      }}
    />
  );
}
