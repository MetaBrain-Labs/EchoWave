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
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontFamilies, spacing, textColors, typography } from '@/shared/theme/tokens';

/** 渲染可点击并可与滑动分页同步的同级标签。 */
export function PageTabs<Tab extends string>({
  activeTab,
  desktop = false,
  onChange,
  tabs,
  testIDPrefix,
}: {
  activeTab: Tab;
  desktop?: boolean;
  onChange: (tab: Tab) => void;
  tabs: readonly { key: Tab; label: string; icon?: keyof typeof Ionicons.glyphMap }[];
  testIDPrefix?: string;
}) {
  return (
    <View accessibilityRole="tablist" style={[styles.tabs, desktop && styles.desktopTabs]}>
      {tabs.map((tab) => {
        const selected = activeTab === tab.key;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected }}
            onPress={() => onChange(tab.key)}
            style={({ pressed }) => [
              styles.tab,
              desktop && styles.desktopTab,
              pressed && styles.pressed,
            ]}
            testID={testIDPrefix ? `${testIDPrefix}-${tab.key}` : undefined}
          >
            {desktop ? (
              <View style={styles.desktopTabContent}>
                {tab.icon ? (
                  <Ionicons
                    color={selected ? colors.primary : textColors.secondary}
                    name={tab.icon}
                    size={22}
                  />
                ) : null}
                <Text
                  style={[styles.tabText, selected && styles.activeTabText, styles.desktopTabText]}
                >
                  {tab.label}
                </Text>
              </View>
            ) : (
              <Text style={[styles.tabText, selected && styles.activeTabText]}>{tab.label}</Text>
            )}
            <View
              style={[
                styles.tabLine,
                desktop && styles.desktopTabLine,
                selected && styles.activeTabLine,
              ]}
            />
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
    minHeight: 34,
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
  activeTabText: { ...typography.heading4, color: colors.primary },
  tabLine: { backgroundColor: 'transparent', height: 2 },
  activeTabLine: { backgroundColor: colors.primary },
  desktopTabs: { gap: spacing.sm, minHeight: 64, paddingHorizontal: spacing.md },
  desktopTab: {
    justifyContent: 'center',
    minHeight: 64,
    paddingHorizontal: spacing.md,
  },
  desktopTabContent: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  desktopTabText: { ...typography.heading2, paddingBottom: 0 },
  desktopTabLine: { bottom: 0, height: 3, left: 0, position: 'absolute', right: 0 },
});
