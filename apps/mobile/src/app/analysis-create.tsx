/**
 * 一键分析独立路由。
 *
 * 从新建方式选择页进入分析表单，并提供返回上一级的原生栈操作。
 *
 * Responsibilities:
 * - 连接 Expo Router 与一键分析功能页面。
 *
 * Notes:
 * - 表单状态与批次提交仍由功能页面负责。
 */
import { useRouter } from 'expo-router';

import { AnalysisBatchCreateScreen } from '@/features/analysis-automation/AnalysisBatchCreateScreen';

/** 渲染带返回操作的一键分析页面。 */
export default function AnalysisCreateRoute() {
  const router = useRouter();
  return <AnalysisBatchCreateScreen onBack={() => router.back()} />;
}
