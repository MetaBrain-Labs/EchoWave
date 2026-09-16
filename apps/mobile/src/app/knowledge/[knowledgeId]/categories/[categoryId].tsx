/**
 * 单个知识库类别编辑路由入口。
 *
 * 仅负责参数规范化和返回导航，类别字段与版本并发检查由类别编辑页面处理。
 *
 * Responsibilities:
 * - 支持预置类别和自定义类别的编辑。
 * - 支持通过同一页面创建新的自定义类别。
 *
 * Notes:
 * - 当前服务端没有硬删除类别接口，停用由编辑页完成。
 */
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';

import { CategoryEditScreen } from '@/features/knowledge/screens/CategoryEditScreen';
import { backOrReplace } from '@/shared/navigation/routeBack';
import { firstRouteParam } from '@/shared/navigation/routeParams';

/** 渲染类别编辑表单并返回类别目录。 */
export default function CategoryEditRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    categoryId?: string | string[];
    knowledgeId?: string | string[];
  }>();
  const categoryId = firstRouteParam(params.categoryId);
  const knowledgeId = firstRouteParam(params.knowledgeId);
  const goBack = () =>
    backOrReplace(router, {
      pathname: '/knowledge/[knowledgeId]/categories',
      params: { knowledgeId },
    } as unknown as Href);

  return <CategoryEditScreen categoryId={categoryId} onBack={goBack} onSaved={() => undefined} />;
}
