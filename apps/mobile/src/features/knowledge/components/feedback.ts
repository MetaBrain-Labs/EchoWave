/**
 * 知识库临时交互反馈。
 *
 * 为尚未实现的知识库操作提供统一提示，避免各页面重复定义文案。
 *
 * Responsibilities:
 * - 展示一致的功能建设中提示。
 *
 * Notes:
 * - 不用于已实现操作的错误反馈。
 */
import { Alert } from 'react-native';

/** 为尚未实现的知识库操作显示一致提示。 */
export function showComingSoon(feature: string): void {
  Alert.alert('功能建设中', `${feature}将在后续版本开放。`);
}
