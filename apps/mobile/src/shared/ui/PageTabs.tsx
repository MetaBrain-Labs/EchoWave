/**
 * 通用同级分页标签。
 *
 * 渲染可访问、可与横向滑动分页同步的紧凑标签栏。
 *
 * Responsibilities:
 * - 表达当前选中标签。
 * - 将点击操作转换为调用方的标签值。
 *
 * Notes:
 * - 不持有分页或手势状态。
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontFamilies, spacing, textColors, typography } from '@/shared/theme/tokens';

/** 渲染可点击并可与滑动分页同步的同级标签。 */
export function PageTabs<Tab extends string>({
  activeTab,
  onChange,
  tabs,
}: {
  activeTab: Tab;
  onChange: (tab: Tab) => void;
  tabs: readonly { key: Tab; label: string }[];
}) {
  return (
    <View accessibilityRole="tablist" style={styles.tabs}>
      {tabs.map((tab) => {
        const selected = activeTab === tab.key;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(tab.key)}
            style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
          >
            <Text style={[styles.tabText, selected && styles.activeTabText]}>{tab.label}</Text>
            <View style={[styles.tabLine, selected && styles.activeTabLine]} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { backgroundColor: colors.background },
  tabs: {
    flexDirection: 'row',
    gap: spacing.lg,
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  tab: { justifyContent: 'flex-end' },
  tabText: {
    ...typography.heading5,
    color: textColors.secondary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
    paddingBottom: spacing.xs,
  },
  activeTabText: { ...typography.heading4, color: textColors.primary },
  tabLine: { backgroundColor: 'transparent', height: 2 },
  activeTabLine: { backgroundColor: colors.ink },
});
