/**
 * 分析详情通用控件。
 *
 * 提供播放器和内容面板共用的图标按钮与复选框。
 *
 * Responsibilities:
 * - 封装稳定的展示职责与局部交互。
 * - 页面级状态和导航仍由 AnalysisDetailScreen 统一协调。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';

export function IconButton({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
    >
      <Ionicons color={colors.ink} name={icon} size={28} />
    </Pressable>
  );
}

export function Checkbox({
  checked,
  label,
  onPress,
}: {
  checked: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={onPress}
      style={({ pressed }) => [styles.checkboxRow, pressed && styles.pressed]}
    >
      <Text style={styles.checkboxLabel}>{label}</Text>
      <View style={[styles.checkbox, checked && styles.checkedCheckbox]}>
        {checked ? <Ionicons color={colors.white} name="checkmark" size={12} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  iconButton: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  pressed: {
    backgroundColor: colors.background,
  },
  checkboxRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 32,
  },
  checkboxLabel: {
    ...typography.heading5,
    color: textColors.primary,
    fontFamily: fontFamilies.sans,
  },
  checkbox: {
    alignItems: 'center',
    borderColor: colors.ink,
    borderRadius: radii.default,
    borderWidth: 1,
    height: 16,
    justifyContent: 'center',
    width: 16,
  },
  checkedCheckbox: {
    backgroundColor: colors.ink,
  },
});
