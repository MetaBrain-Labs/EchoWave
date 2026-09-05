/**
 * 新建标签路由入口。
 *
 * 将底部新建标签连接到一键式音频全流程分析。
 *
 * Responsibilities:
 * - 提供 Expo Router 页面导出。
 *
 * Notes:
 * - 业务状态由功能页面和服务端批次持有。
 */
import { AnalysisBatchCreateScreen } from '@/features/analysis-automation/AnalysisBatchCreateScreen';

/** 渲染新建区域的当前里程碑占位页面。 */
export default function CreateScreen() {
  return <AnalysisBatchCreateScreen />;
}
