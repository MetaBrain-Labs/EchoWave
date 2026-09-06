/**
 * 新手引导中心路由。
 *
 * 连接引导目录页面和 Expo Router 返回行为。
 *
 * Responsibilities:
 * - 渲染引导中心。
 * - 提供返回上一页的导航动作。
 */
import { useRouter } from 'expo-router';

import { GuideCenterScreen } from '@/features/onboarding/GuideCenterScreen';

/** 连接引导中心与导航。 */
export default function GuidesRoute() {
  const router = useRouter();
  return <GuideCenterScreen onBack={() => router.back()} />;
}
