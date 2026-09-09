/**
 * 服务器连接设置路由。
 *
 * 绑定返回导航并复用首次启动连接页面，不持有服务器业务状态。
 *
 * Responsibilities:
 * - 将设置页导航回调绑定到连接表单。
 *
 * Notes:
 * - 首次启动由根布局直接渲染同一表单，不经过本路由。
 */
import { useRouter } from 'expo-router';

import { ServerConnectionScreen } from '@/features/server-connection/ServerConnectionScreen';
import { backOrReplace } from '@/shared/navigation/routeBack';

/** 渲染已进入主应用后的服务器切换入口。 */
export default function ServerConnectionRoute() {
  const router = useRouter();
  const leave = () => backOrReplace(router, '/');
  return <ServerConnectionScreen onCancel={leave} onSaved={leave} />;
}
