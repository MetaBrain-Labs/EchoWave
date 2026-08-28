/**
 * 分组设置路由入口。
 *
 * 规范化动态分组参数，并连接设置页的返回和归档后导航。
 *
 * Responsibilities:
 * - 将 Expo Router 参数传给 feature 页面。
 * - 归档成功后返回分组主界面。
 *
 * Notes:
 * - 表单和网络状态保留在 feature 层。
 */
import { useLocalSearchParams, useRouter } from 'expo-router';

import { GroupSettingsScreen } from '@/features/group-settings/GroupSettingsScreen';
import { firstRouteParam } from '@/shared/navigation/routeParams';

/** 渲染路由指定分组的设置页面。 */
export default function GroupSettingsRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ groupId?: string | string[] }>();
  const groupId = firstRouteParam(params.groupId);
  return (
    <GroupSettingsScreen
      groupId={groupId}
      onArchived={() => router.replace('/')}
      onBack={() => router.back()}
    />
  );
}
