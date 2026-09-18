/**
 * 输入框文字样式令牌。
 *
 * 落实设计系统第 9 节：输入框的文字与光标必须落在稳定、居中的行盒内，
 * 不依赖平台默认字体内边距，避免 Android 上出现超出文字高度的粗光标与上下偏移。
 *
 * Responsibilities:
 * - 提供单行输入框的共享文字样式。
 * - 提供多行输入框的共享文字样式（纵向顶部对齐）。
 *
 * Notes:
 * - 只包含文字与对齐规则；背景、边框、圆角和尺寸仍由各组件样式负责。
 * - 固定高度单行输入框必须在自身样式里显式声明 `height` 与水平内边距。
 */
import { fontFamilies, textColors } from './tokens';

/** 单行输入框共享文字样式：垂直居中且不额外增加行盒。 */
export const textInputText = {
  color: textColors.primary,
  fontFamily: fontFamilies.sans,
  includeFontPadding: false,
  paddingVertical: 0,
  textAlignVertical: 'center',
} as const;

/** 多行输入框共享文字样式：顶部对齐，保留行间距。 */
export const multilineTextInputText = {
  color: textColors.primary,
  fontFamily: fontFamilies.sans,
  includeFontPadding: false,
  textAlignVertical: 'top',
} as const;
