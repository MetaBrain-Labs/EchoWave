/**
 * 服务配置路由。
 *
 * 将 Expo Router 导航回调绑定到服务配置功能页面。
 *
 * Responsibilities:
 * - 保持路由层无业务状态。
 *
 * Notes:
 * - 管理员会话由根级共享 Provider 持有，不随本路由卸载而恢复。
 */
import { useRouter, type Href } from 'expo-router';

import { ServiceConfigurationScreen } from '@/features/service-config/ServiceConfigurationScreen';
import { backOrReplace } from '@/shared/navigation/routeBack';

/** 渲染租户级服务器配置入口。 */
export default function ServiceConfigurationRoute() {
  const router = useRouter();
  return (
    <ServiceConfigurationScreen
      onBack={() => backOrReplace(router, '/(tabs)/more' as Href)}
      onOpenAi={() => router.push('/settings' as Href)}
      onOpenRuntime={() => router.push('/audio-runtime' as Href)}
    />
  );
}
