/**
 * 模板分析示例路由入口。
 *
 * 解析分组参数并连接只读示例页面与 Expo Router。
 *
 * Responsibilities:
 * - 规范化 groupId 参数。
 * - 提供详情页返回行为。
 */
import { useLocalSearchParams, useRouter } from 'expo-router';

import { TemplateExampleScreen } from '@/features/template-examples/TemplateExampleScreen';
import { firstRouteParam } from '@/shared/navigation/routeParams';

/** 连接模板示例页面与导航。 */
export default function TemplateExampleRoute() {
  const router = useRouter();
  const { groupId } = useLocalSearchParams<{ groupId?: string | string[] }>();
  const id = firstRouteParam(groupId);
  return <TemplateExampleScreen groupId={id} onBack={() => router.back()} />;
}
