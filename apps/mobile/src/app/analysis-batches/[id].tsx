/**
 * 自动分析批次详情路由。
 *
 * 只规范化 Expo Router 参数并把导航能力交给功能页面。
 *
 * Responsibilities:
 * - 拒绝缺失或数组形式的批次 ID。
 * - 保持路由入口不持有业务状态。
 */
import { useLocalSearchParams, useRouter } from 'expo-router';

import { AnalysisBatchDetailScreen } from '@/features/analysis-automation/AnalysisBatchDetailScreen';

/** 渲染由路径参数指定的批次详情。 */
export default function AnalysisBatchDetailRoute() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const batchId = Array.isArray(id) ? id[0] : id;
  if (!batchId) return null;
  return <AnalysisBatchDetailScreen batchId={batchId} router={router} />;
}
