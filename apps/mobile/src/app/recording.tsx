/**
 * 手机录音路由。
 *
 * 规范化数据源及草稿参数，交由录音 feature 渲染。
 *
 * Responsibilities:
 * - 绑定返回导航与可选资源参数。
 *
 * Notes:
 * - 不创建录音实例或发起网络操作。
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { RecordingScreen } from '@/features/recording';
/** 将路由参数传入录音页面。 */
export default function RecordingRoute() {
  const params = useLocalSearchParams<{ sourceId?: string; draftId?: string }>();
  const router = useRouter();
  return (
    <RecordingScreen
      sourceId={typeof params.sourceId === 'string' ? params.sourceId : undefined}
      draftId={typeof params.draftId === 'string' ? params.draftId : undefined}
      onBack={() => router.back()}
    />
  );
}
