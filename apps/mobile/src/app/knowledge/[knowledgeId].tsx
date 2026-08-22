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
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';

import { KnowledgeDetailScreen } from '@/features/knowledge/screens/KnowledgeDetailScreen';
import { useNavigationLoading } from '@/shared/navigation/NavigationLoadingProvider';
import { firstRouteParam } from '@/shared/navigation/routeParams';

/** 读取知识库 ID 并连接详情、文档与问答路由。 */
export default function KnowledgeDetailRoute() {
  const router = useRouter();
  const { runWithLoading } = useNavigationLoading();
  const { knowledgeId } = useLocalSearchParams<{ knowledgeId?: string | string[] }>();
  const id = firstRouteParam(knowledgeId);
  const goBack = () => {
    void runWithLoading(() => {
      router.replace('/knowledge');
    });
  };

  return (
    <KnowledgeDetailScreen
      knowledgeId={id}
      onBack={goBack}
      onAsk={() => {
        void runWithLoading(() => router.push(`/knowledge/${id}/ask` as Href));
      }}
      onOpenDocument={(documentId) => {
        void runWithLoading(() =>
          router.push({
            pathname: '/knowledge/[knowledgeId]/files/[fileId]',
            params: { fileId: documentId, knowledgeId: id },
          }),
        );
      }}
      onSwitchGroup={(groupId) => {
        void runWithLoading(() => {
          router.replace({ pathname: '/', params: { groupId, tab: 'knowledge' } });
        });
      }}
    />
  );
}
