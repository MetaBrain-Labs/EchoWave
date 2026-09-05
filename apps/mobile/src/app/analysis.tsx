/**
 * 分析工作区路由。
 *
 * 将分析运行记录从底部标签中独立出来，作为“更多”页的详情入口，并提供返回导航。
 *
 * Responsibilities:
 * - 渲染统一分析运行记录列表。
 * - 将独立页面返回到进入前的导航栈。
 *
 * Notes:
 * - 分析详情、批次详情和报告继续使用既有动态路由。
 */
import { useRouter } from 'expo-router';

import { AnalysisRunsScreen } from '@/features/analysis-runs/AnalysisRunsScreen';

/** 渲染独立的分析工作区页面。 */
export default function AnalysisRoute() {
  const router = useRouter();
  return <AnalysisRunsScreen onBack={() => router.back()} />;
}
