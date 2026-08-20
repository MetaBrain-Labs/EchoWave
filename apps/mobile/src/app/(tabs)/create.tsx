/**
 * 新建标签路由入口。
 *
 * 将底部新建标签连接到当前里程碑的占位页面。
 *
 * Responsibilities:
 * - 提供 Expo Router 页面导出。
 *
 * Notes:
 * - 真实创建工作流尚未接入。
 */
import { PlaceholderScreen } from '@/shared/ui/PlaceholderScreen';

/** 渲染新建区域的当前里程碑占位页面。 */
export default function CreateScreen() {
  return (
    <PlaceholderScreen
      description="后续可从这里上传音频、创建分析任务或连接新的内容来源。"
      icon="add-circle-outline"
      title="新建"
    />
  );
}
