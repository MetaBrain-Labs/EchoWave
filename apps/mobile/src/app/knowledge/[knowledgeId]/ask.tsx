/**
 * 问知识库路由入口。
 *
 * 将知识库参数传给临时问答页面，并把最终引用链接转换为文档块详情路由；
 * 从分组进入时加载该分组的全部关联知识库，作为默认跨库检索范围。
 *
 * Responsibilities:
 * - 连接问答页面与返回导航。
 * - 将 citation 选择映射到可追溯原文页面。
 * - 按分组解析跨库检索范围。
 *
 * Notes:
 * - 会话状态不写入本地存储。
 * - 每次带 session 参数进入都视为一次新聊天：页面重新挂载，记忆与检索类别重新开始。
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

import { KnowledgeQueryScreen } from '@/features/knowledge/screens/KnowledgeQueryScreen';
import { listGroupKnowledgeBases } from '@/shared/api/groupsApi';
import { parseResourceOrigin } from '@/shared/navigation/resourceOrigin';
import { backOrReplace } from '@/shared/navigation/routeBack';
import { firstRouteParam } from '@/shared/navigation/routeParams';

/** 渲染指定知识库的临时可信问答页面。 */
export default function KnowledgeQueryRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    groupId?: string | string[];
    guideDemo?: string | string[];
    knowledgeId?: string | string[];
    origin?: string | string[];
    preselect?: string | string[];
    session?: string | string[];
  }>();
  const knowledgeId = firstRouteParam(params.knowledgeId);
  const guideDemo = firstRouteParam(params.guideDemo) === 'true';
  const groupId = firstRouteParam(params.groupId);
  const preselectCategories = firstRouteParam(params.preselect) === 'all';
  const origin = parseResourceOrigin(params.origin) ?? 'knowledge-list';
  /** 本次进入的唯一标识：变化即重挂载问答页，从而开始一段新聊天。 */
  const session = firstRouteParam(params.session) || 'default';
  const [knowledgeBases, setKnowledgeBases] = useState<{ id: string; name: string }[]>();

  // 分组入口：读取全部关联知识库作为默认检索范围；失败时回退为当前知识库。
  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!groupId) return undefined;
      try {
        const response = await listGroupKnowledgeBases(groupId);
        return response.items.map((item) => ({ id: item.id, name: item.name }));
      } catch {
        return undefined;
      }
    };
    void load().then((items) => {
      if (active) setKnowledgeBases(items);
    });
    return () => {
      active = false;
    };
  }, [groupId]);

  return (
    <KnowledgeQueryScreen
      guideDemo={guideDemo}
      key={session}
      knowledgeBases={knowledgeBases}
      knowledgeId={knowledgeId}
      onBack={() =>
        backOrReplace(router, {
          pathname: '/knowledge/[knowledgeId]',
          params: {
            knowledgeId,
            origin,
            ...(groupId ? { groupId } : {}),
            ...(guideDemo ? { guideDemo: 'true' } : {}),
          },
        })
      }
      onOpenCitation={(documentId, chunkId) =>
        // 查看引用原文属于同一次聊天：带上 session，返回时继续保留记忆与冻结的检索类别。
        router.push({
          pathname: '/knowledge/[knowledgeId]/files/[fileId]/blocks/[blockId]',
          params: {
            knowledgeId,
            fileId: documentId,
            blockId: chunkId,
            returnTo: 'knowledge-query',
            origin,
            session,
            ...(groupId ? { groupId } : {}),
            ...(guideDemo ? { guideDemo: 'true' } : {}),
          },
        })
      }
      preselectCategories={preselectCategories}
      sessionId={session}
    />
  );
}
