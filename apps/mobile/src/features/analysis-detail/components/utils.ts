/**
 * 分析详情展示工具。
 *
 * 集中时间格式化和未开放功能提示，避免内容组件重复实现展示规则。
 *
 * Responsibilities:
 * - 将秒数格式化为播放器使用的时间文本。
 * - 提供一致的功能建设中提示。
 */
import { Alert } from "react-native";

/** 将秒数格式化为两位分钟和秒钟。 */
export function formatTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** 展示统一的功能建设中提示。 */
export function showComingSoon(feature: string) {
  Alert.alert("功能建设中", `${feature}将在后续版本开放。`);
}

