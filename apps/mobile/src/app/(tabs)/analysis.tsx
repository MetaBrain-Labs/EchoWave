/**
 * 分析标签路由入口。
 *
 * 将底部分析标签连接到当前里程碑的占位页面。
 *
 * Responsibilities:
 * - 提供 Expo Router 页面导出。
 *
 * Notes:
 * - 真实分析列表尚未接入。
 */
import { PlaceholderScreen } from "@/shared/ui/PlaceholderScreen";

/** 渲染分析区域的当前里程碑占位页面。 */
export default function AnalysisScreen() {
  return (
    <PlaceholderScreen
      description="这里将汇总分析进度、结果和跨分组洞察等功能。"
      icon="stats-chart-outline"
      title="分析"
    />
  );
}
