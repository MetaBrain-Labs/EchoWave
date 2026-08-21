/**
 * 分析详情会话偏好。
 *
 * 保存分析详情页面在当前应用进程内的非权威 UI 选择，避免把展示偏好混入业务数据。
 *
 * Responsibilities:
 * - 读取和更新当前会话的展示偏好。
 *
 * Notes:
 * - 不写入浏览器或设备持久化存储。
 */
let hideIrrelevantSegments = false;

/** 读取当前应用进程内“隐藏无关片段”的展示偏好。 */
export function getHideIrrelevantSegmentsPreference() {
  return hideIrrelevantSegments;
}

/** 更新当前应用进程内的非权威展示偏好。 */
export function setHideIrrelevantSegmentsPreference(value: boolean) {
  hideIrrelevantSegments = value;
}
