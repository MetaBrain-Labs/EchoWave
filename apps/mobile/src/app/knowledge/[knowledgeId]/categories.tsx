/**
 * 知识库类别管理路由入口。
 *
 * 将类别目录从知识库编辑页中拆出，保持管理动作与默认类别选择的任务边界清晰。
 *
 * Responsibilities:
 * - 连接类别目录、类别新增和类别编辑页面。
 * - 保留返回知识库编辑页所需的路由上下文。
 *
 * Notes:
 * - 类别目录数据由类别管理页面通过现有 API 加载。
 */
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';

import { CategoryManagementScreen } from '@/features/knowledge/screens/CategoryManagementScreen';
import { backOrReplace } from '@/shared/navigation/routeBack';
import { firstRouteParam } from '@/shared/navigation/routeParams';
import { parseResourceOrigin } from '@/shared/navigation/resourceOrigin';

/** 渲染类别目录并连接新增、编辑导航。 */
export default function CategoryManagementRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    groupId?: string | string[];
    knowledgeId?: string | string[];
    origin?: string | string[];
  }>();
  const knowledgeId = firstRouteParam(params.knowledgeId);
  const groupId = firstRouteParam(params.groupId);
  const origin = parseResourceOrigin(params.origin);
  const goBack = () => {
    backOrReplace(router, {
      pathname: '/knowledge/[knowledgeId]/edit',
      params: {
        knowledgeId,
        ...(origin ? { origin } : {}),
        ...(groupId ? { groupId } : {}),
      },
    });
  };

  return (
    <CategoryManagementScreen
      onAddCategory={() =>
        router.push({
          pathname: '/knowledge/[knowledgeId]/categories/[categoryId]',
          params: { categoryId: 'new', knowledgeId },
        } as unknown as Href)
      }
      onBack={goBack}
      onOpenCategory={(categoryId) =>
        router.push({
          pathname: '/knowledge/[knowledgeId]/categories/[categoryId]',
          params: { categoryId, knowledgeId },
        } as unknown as Href)
      }
    />
  );
}
