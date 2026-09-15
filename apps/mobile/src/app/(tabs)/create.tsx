/**
 * 新建标签路由入口。
 *
 * 将底部加号连接到分析与手机录音两个独立入口。
 *
 * Responsibilities:
 * - 提供 Expo Router 页面导出。
 *
 * Notes:
 * - 业务状态由功能页面和服务端批次持有。
 */
import { useRouter, type Href } from 'expo-router';

import { CreateHubScreen } from '@/features/create/CreateHubScreen';

/** 渲染新建方式选择，并将导航动作保持在路由层。 */
export default function CreateScreen() {
  const router = useRouter();
  return (
    <CreateHubScreen
      onOpenAnalysis={() => router.push('/analysis-create' as Href)}
      onOpenRecording={() => router.push('/recording' as Href)}
    />
  );
}
