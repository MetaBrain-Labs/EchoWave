/**
 * 录音功能公开界面。
 *
 * 为路由和数据源页面提供组件，内部操作仍由共享录音模块管理。
 *
 * Responsibilities:
 * - 导出录音页面及本机待上传列表。
 *
 * Notes:
 * - 消费者不得依赖录音 feature 的内部组件。
 */
export { RecordingScreen, RecordingDraftList } from './RecordingScreen';
