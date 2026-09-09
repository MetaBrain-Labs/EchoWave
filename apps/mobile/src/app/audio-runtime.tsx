/**
 * 音频运行模式路由。
 *
 * 将 Expo Router 返回行为绑定到运行模式功能页面。
 */
import { useRouter } from 'expo-router';

import { AudioRuntimeScreen } from '@/features/audio-runtime/AudioRuntimeScreen';
import { backOrReplace } from '@/shared/navigation/routeBack';

/** 渲染音频运行模式页面。 */
export default function AudioRuntimeRoute() {
  const router = useRouter();
  return <AudioRuntimeScreen onBack={() => backOrReplace(router, '/')} />;
}
