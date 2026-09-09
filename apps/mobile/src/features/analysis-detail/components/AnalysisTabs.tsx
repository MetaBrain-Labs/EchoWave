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

import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import type { TranslationKey } from '@/shared/i18n/translations';
import { colors, fontFamilies, spacing, textColors, typography } from '@/shared/theme/tokens';

export type AnalysisTab = 'transcript' | 'tasks' | 'summary' | 'model';
const analysisTabs: readonly { key: AnalysisTab; labelKey: TranslationKey }[] = [
  { key: 'transcript', labelKey: 'analysis.tabs.transcript' },
  { key: 'tasks', labelKey: 'analysis.tabs.tasks' },
  { key: 'summary', labelKey: 'analysis.tabs.summary' },
  { key: 'model', labelKey: 'analysis.tabs.model' },
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
  const { t } = useAppLanguage();
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
                {t(tab.labelKey)}
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
    minHeight: 34,
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
