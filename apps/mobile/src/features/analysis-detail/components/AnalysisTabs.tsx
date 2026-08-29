/**
 * 分析详情标签导航。
 *
 * 定义转写与总结两个稳定标签，并负责渲染无状态标签控件。
 *
 * Responsibilities:
 * - 封装稳定的展示职责与局部交互。
 * - 页面级状态和导航仍由 AnalysisDetailScreen 统一协调。
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontFamilies, spacing, textColors, typography } from '@/shared/theme/tokens';

export type AnalysisTab = 'transcript' | 'summary' | 'model';
const analysisTabs: readonly { key: AnalysisTab; label: string }[] = [
  { key: 'transcript', label: '转写分析' },
  { key: 'summary', label: '分析总结' },
  { key: 'model', label: '模型详情' },
];
export const analysisTabKeys = analysisTabs.map((tab) => tab.key);

export function DetailTabs({
  activeTab,
  onChange,
  showSummary = true,
}: {
  activeTab: AnalysisTab;
  onChange: (tab: AnalysisTab) => void;
  showSummary?: boolean;
}) {
  return (
    <View accessibilityRole="tablist" style={styles.detailTabs}>
      {analysisTabs
        .filter((tab) => showSummary || tab.key !== 'summary')
        .map((tab) => {
          const selected = tab.key === activeTab;
          return (
            <Pressable
              key={tab.key}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => onChange(tab.key)}
              style={({ pressed }) => [styles.detailTab, pressed && styles.pressed]}
            >
              <Text style={[styles.detailTabText, selected && styles.activeDetailTabText]}>
                {tab.label}
              </Text>
              <View style={[styles.tabUnderline, selected && styles.activeTabUnderline]} />
            </Pressable>
          );
        })}
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: {
    backgroundColor: colors.background,
  },
  detailTabs: {
    flexDirection: 'row',
    gap: spacing.lg,
    minHeight: 64,
    paddingHorizontal: spacing.md,
  },
  detailTab: {
    justifyContent: 'flex-end',
  },
  detailTabText: {
    ...typography.heading5,
    color: textColors.secondary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
    paddingBottom: spacing.xs,
  },
  activeDetailTabText: {
    ...typography.heading4,
    color: textColors.primary,
  },
  tabUnderline: {
    backgroundColor: 'transparent',
    height: 2,
  },
  activeTabUnderline: {
    backgroundColor: colors.ink,
  },
});
