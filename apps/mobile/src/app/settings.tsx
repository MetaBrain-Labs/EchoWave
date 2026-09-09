/**
 * AI 配置路由。
 *
 * 将 Expo Router 导航回调绑定到配置中心功能页面。
 *
 * Responsibilities:
 * - 保持路由层无业务状态。
 *
 * Notes:
 * - 管理员会话随功能页面卸载而销毁。
 */
import { useRouter } from 'expo-router';

import { SettingsScreen } from '@/features/settings/SettingsScreen';
import { backOrReplace } from '@/shared/navigation/routeBack';

/** 渲染 AI 配置中心。 */
export default function SettingsRoute() {
  const router = useRouter();
  return <SettingsScreen onBack={() => backOrReplace(router, '/')} />;
}
