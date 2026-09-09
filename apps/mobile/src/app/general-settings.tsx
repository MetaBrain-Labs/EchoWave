/**
 * 通用设置路由入口。
 *
 * 将应用级偏好设置页面连接到 Expo Router 的返回行为。
 *
 * Responsibilities:
 * - 渲染通用设置页面。
 * - 提供返回上一页的导航动作。
 *
 * Notes:
 * - 具体设置状态由功能页面与对应 Provider 管理。
 */
import { useRouter } from 'expo-router';

import { GeneralSettingsScreen } from '@/features/general-settings/GeneralSettingsScreen';

/** 连接通用设置页面与导航。 */
export default function GeneralSettingsRoute() {
  const router = useRouter();
  return <GeneralSettingsScreen onBack={() => router.back()} />;
}
