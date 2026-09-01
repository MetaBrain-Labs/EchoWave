/**
 * 知识库详情路由入口。
 *
 * 将知识库 ID 连接到文件、关联分组、上传和问答入口，并负责详情层级导航。
 *
 * Responsibilities:
 * - 传递知识库路由参数。
 * - 跳转到文档详情与可信问答页面。
 *
 * Notes:
 * - 数据加载由知识库 feature 页面负责。
 */
import { useLocalSearchParams, useRouter } from 'expo-router';

import { KnowledgeDetailScreen } from '@/features/knowledge/screens/KnowledgeDetailScreen';
import { parseResourceOrigin } from '@/shared/navigation/resourceOrigin';
import { backOrReplace } from '@/shared/navigation/routeBack';
import { firstRouteParam } from '@/shared/navigation/routeParams';

/** 读取知识库 ID 并连接详情、文档与问答路由。 */
export default function KnowledgeDetailRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    groupId?: string | string[];
    knowledgeId?: string | string[];
    origin?: string | string[];
  }>();
  const { knowledgeId } = params;
  const id = firstRouteParam(knowledgeId);
  const groupId = firstRouteParam(params.groupId);
  const origin = parseResourceOrigin(params.origin);
  const goBack = () => {
    if (origin === 'group' && groupId) {
      backOrReplace(router, { pathname: '/', params: { groupId, tab: 'knowledge' } });
    } else {
      backOrReplace(router, '/(tabs)/knowledge');
    }
  };

  return (
    <KnowledgeDetailScreen
      knowledgeId={id}
      onBack={goBack}
      onAsk={() =>
        router.push({
          pathname: '/knowledge/[knowledgeId]/ask',
          params: {
            knowledgeId: id,
            origin: origin ?? 'knowledge-list',
            ...(groupId ? { groupId } : {}),
          },
        })
      }
      onOpenDocument={(documentId) => {
        router.push({
          pathname: '/knowledge/[knowledgeId]/files/[fileId]',
          params: {
            fileId: documentId,
            knowledgeId: id,
            origin: origin ?? 'knowledge-list',
            ...(groupId ? { groupId } : {}),
          },
        });
      }}
      onSwitchGroup={(groupId) => {
        router.replace({ pathname: '/', params: { groupId, tab: 'knowledge' } });
      }}
    />
  );
}
