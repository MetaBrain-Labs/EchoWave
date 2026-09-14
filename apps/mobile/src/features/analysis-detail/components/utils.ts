/**
 * 分析详情展示工具。
 *
 * 集中时间格式化，避免内容组件重复实现展示规则。
 *
 * Responsibilities:
 * - 将秒数格式化为播放器使用的时间文本。
 */
/** 将秒数格式化为两位分钟和秒钟。 */
export function formatTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
