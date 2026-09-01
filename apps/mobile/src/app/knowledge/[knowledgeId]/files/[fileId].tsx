/**
 * 知识文档详情路由入口。
 *
 * 读取知识库和文档参数，连接文档详情标签与文档块导航。
 *
 * Responsibilities:
 * - 传递文档层级参数。
 * - 将文档块选择转换为详情路由。
 *
 * Notes:
 * - 文档内容以服务器响应为准。
 */
import { useLocalSearchParams, useRouter } from 'expo-router';

import { DocumentDetailScreen } from '@/features/knowledge/screens/DocumentDetailScreen';
import { parseResourceOrigin } from '@/shared/navigation/resourceOrigin';
import { firstRouteParam } from '@/shared/navigation/routeParams';

/** 渲染指定知识文档并连接文档块详情导航。 */
export default function DocumentDetailRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    block?: string | string[];
    fileId?: string | string[];
    groupId?: string | string[];
    knowledgeId?: string | string[];
    origin?: string | string[];
    returnTo?: string | string[];
    tab?: string | string[];
  }>();
  const knowledgeId = firstRouteParam(params.knowledgeId);
  const documentId = firstRouteParam(params.fileId);
  const groupId = firstRouteParam(params.groupId);
  const origin = parseResourceOrigin(params.origin) ?? 'knowledge-list';
  const blockId = firstRouteParam(params.block);
  const initialTab = firstRouteParam(params.tab) === 'original' ? 'original' : 'parsed';
  const returnsToQuery = firstRouteParam(params.returnTo) === 'knowledge-query';
  const goBack = () => {
    if (returnsToQuery && router.canGoBack()) {
      router.back();
    } else {
      router.replace({
        pathname: '/knowledge/[knowledgeId]',
        params: { knowledgeId, origin, ...(groupId ? { groupId } : {}) },
      });
    }
  };

  return (
    <DocumentDetailScreen
      documentId={documentId}
      initialBlockId={blockId || undefined}
      initialTab={initialTab}
      knowledgeId={knowledgeId}
      onBack={goBack}
      onOpenBlock={(nextBlockId) => {
        router.push({
          pathname: '/knowledge/[knowledgeId]/files/[fileId]/blocks/[blockId]',
          params: {
            blockId: nextBlockId,
            fileId: documentId,
            knowledgeId,
            origin,
            ...(groupId ? { groupId } : {}),
            ...(returnsToQuery ? { returnTo: 'knowledge-query' } : {}),
          },
        });
      }}
    />
  );
}
