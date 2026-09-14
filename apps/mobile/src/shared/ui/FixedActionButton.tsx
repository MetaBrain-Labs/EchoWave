/**
 * 页面底栏操作按钮。
 *
 * Responsibilities:
 * - 统一知识库及收集页面的居中图标、字号和主次操作层级。
 * - 保留禁用语义，不通过整体透明度改变文字颜色。
 * Notes:
 * - 仅负责展示，确认和保存由业务页面管理。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text } from 'react-native';
import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';

/** 主操作使用黑底白字，次操作沿用浅色底栏按钮。 */
export function FixedActionButton({
  label,
  icon,
  onPress,
  emphasized = false,
  disabled = false,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  emphasized?: boolean;
  disabled?: boolean;
}) {
  const foreground = disabled
    ? textColors.secondary
    : emphasized
      ? colors.white
      : textColors.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        emphasized && styles.primary,
        disabled && styles.disabled,
        pressed && !disabled && (emphasized ? styles.primaryPressed : styles.pressed),
      ]}
    >
      <Ionicons name={icon} size={typography.body.lineHeight} color={foreground} />
      <Text style={[styles.text, { color: foreground }]}>{label}</Text>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  button: {
    flex: 1,
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.background,
    borderColor: colors.divider,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.default,
  },
  primary: { backgroundColor: colors.ink, borderColor: colors.ink },
  disabled: { backgroundColor: colors.divider, borderColor: colors.divider },
  pressed: { backgroundColor: colors.divider },
  primaryPressed: { backgroundColor: colors.black },
  text: {
    ...typography.body,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
    textAlign: 'center',
  },
});
