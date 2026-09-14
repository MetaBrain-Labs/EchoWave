/**
 * 收集规则文件夹路由。
 *
 * Responsibilities:
 * - 传递库、文件夹及搜索上下文，绑定案例与规则导航。
 * Notes:
 * - 历史整理作为独立页面进入。
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CollectionFolderScreen } from '@/features/knowledge/screens/CollectionFolderScreen';
import { firstRouteParam } from '@/shared/navigation/routeParams';
import { backOrReplace } from '@/shared/navigation/routeBack';

/** 文件夹内容不改变原案例链接语义。 */
export default function CollectionFolderRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    knowledgeId?: string | string[];
    folderId?: string | string[];
    query?: string | string[];
    organize?: string | string[];
  }>();
  const knowledgeId = firstRouteParam(params.knowledgeId),
    folderId = firstRouteParam(params.folderId);
  return (
    <CollectionFolderScreen
      key={`${folderId}:${firstRouteParam(params.organize)}`}
      knowledgeId={knowledgeId}
      folderId={folderId}
      initialQuery={firstRouteParam(params.query)}
      organizing={firstRouteParam(params.organize) === 'true'}
      onBack={() =>
        backOrReplace(router, { pathname: '/knowledge/[knowledgeId]', params: { knowledgeId } })
      }
      onOpenCase={(caseId, editing) =>
        router.push({
          pathname: '/collection',
          params: { caseId, ...(editing ? { edit: 'true' } : {}) },
        })
      }
      onViewRule={(groupId, ruleId) =>
        router.push({
          pathname: '/collection',
          params: { groupId, ruleId, view: 'rule', defaultKnowledgeId: knowledgeId },
        })
      }
      onOrganize={() =>
        router.push({
          pathname: '/knowledge/[knowledgeId]/folders/[folderId]',
          params: { knowledgeId, folderId, organize: 'true' },
        })
      }
    />
  );
}
