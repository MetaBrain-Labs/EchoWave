/**
 * 一级页面固定页头。
 *
 * 为底部导航对应的一级页面提供统一的安全区后标题节奏与操作按钮视觉。
 *
 * Responsibilities:
 * - 呈现一级页面标题、可选说明和右侧操作。
 * - 统一操作热区、描边按钮、按压反馈与无障碍状态。
 *
 * Notes:
 * - 安全区由页面容器负责，组件自身只管理安全区之后的固定页头布局。
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

/** 描述一级页头中的单个图标或文字操作。 */
export type TopLevelPageAction = {
  accessibilityLabel: string;
  disabled?: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  label?: string;
  onPress: () => void;
};

/** 描述一级页头的标题、说明和操作集合。 */
export type TopLevelPageHeaderProps = {
  actions?: TopLevelPageAction[];
  subtitle?: string;
  title: string;
};

/** 渲染安全区之后保持固定的一级页面页头。 */
export function TopLevelPageHeader({ actions = [], subtitle, title }: TopLevelPageHeaderProps) {
  return (
    <View style={styles.header} testID="top-level-page-header">
      <View style={styles.titleRow}>
        <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>
          {title}
        </Text>
        {actions.length ? (
          <View style={styles.actions}>
            {actions.map((action) => {
              const labeled = Boolean(action.label);
              return (
                <Pressable
                  accessibilityLabel={action.accessibilityLabel}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: action.disabled }}
                  disabled={action.disabled}
                  hitSlop={labeled ? undefined : 8}
                  key={action.accessibilityLabel}
                  onPress={action.onPress}
                  style={({ pressed }) => [
                    labeled ? styles.labeledAction : styles.iconAction,
                    action.disabled && styles.disabled,
                    pressed && styles.pressed,
                  ]}
                >
                  <Ionicons
                    color={colors.ink}
                    name={action.icon}
                    size={labeled ? typography.body.lineHeight : 30}
                  />
                  {action.label ? <Text style={styles.actionLabel}>{action.label}</Text> : null}
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </View>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: colors.canvas,
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
  },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  title: {
    ...typography.heading1,
    color: textColors.primary,
    flexShrink: 1,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginLeft: spacing.sm,
  },
  iconAction: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  labeledAction: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 44,
    paddingHorizontal: spacing.base,
  },
  actionLabel: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  subtitle: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    marginTop: spacing.sm,
  },
  disabled: { opacity: 0.45 },
  pressed: {
    backgroundColor: colors.background,
    borderRadius: radii.default,
  },
});
