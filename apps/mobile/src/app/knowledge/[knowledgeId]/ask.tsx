/**
 * 问知识库路由入口。
 *
 * 将知识库参数传给临时问答页面，并把最终引用链接转换为文档块详情路由。
 *
 * Responsibilities:
 * - 连接问答页面与返回导航。
 * - 将 citation 选择映射到可追溯原文页面。
 *
 * Notes:
 * - 会话状态不写入本地存储。
 */
import { useLocalSearchParams, useRouter } from 'expo-router';

import { KnowledgeQueryScreen } from '@/features/knowledge/screens/KnowledgeQueryScreen';
import { firstRouteParam } from '@/shared/navigation/routeParams';

/** 渲染指定知识库的临时可信问答页面。 */
export default function KnowledgeQueryRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ knowledgeId?: string | string[] }>();
  const knowledgeId = firstRouteParam(params.knowledgeId);
  return (
    <KnowledgeQueryScreen
      knowledgeId={knowledgeId}
      onBack={() => router.replace({ pathname: '/knowledge/[knowledgeId]', params: { knowledgeId } })}
      onOpenCitation={(documentId, chunkId) => router.push({
        pathname: '/knowledge/[knowledgeId]/files/[fileId]/blocks/[blockId]',
        params: {
          knowledgeId,
          fileId: documentId,
          blockId: chunkId,
          returnTo: 'knowledge-query',
        },
      })}
    />
  );
}
