/**
 * 知识库标签路由入口。
 *
 * 将知识库列表与详情层级连接，并把路由行为隔离在 Expo Router 页面中。
 *
 * Responsibilities:
 * - 渲染知识库目录。
 * - 将知识库选择转换为详情路由。
 *
 * Notes:
 * - 数据请求由 feature 模块负责。
 */
import { useRouter } from 'expo-router';

import { KnowledgeListScreen } from '@/features/knowledge/screens/KnowledgeListScreen';

/** 连接知识库目录与知识库详情导航。 */
export default function KnowledgeScreen() {
  const router = useRouter();

  return (
    <KnowledgeListScreen
      onOpenKnowledge={(knowledgeId) => {
        router.push({
          pathname: '/knowledge/[knowledgeId]',
          params: { knowledgeId, origin: 'knowledge-list' },
        });
      }}
    />
  );
}
