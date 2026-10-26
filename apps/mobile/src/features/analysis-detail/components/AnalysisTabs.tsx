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

/** 按当前视口样式显示分析详情分页，同时保留原有活动页状态与回调。 */
export function DetailTabs({
  activeTab,
  onChange,
  desktop = false,
  showSummary = true,
  transcriptLabel,
  visibleTabs,
}: {
  activeTab: AnalysisTab;
  onChange: (tab: AnalysisTab) => void;
  desktop?: boolean;
  showSummary?: boolean;
  transcriptLabel?: string;
  visibleTabs?: readonly AnalysisTab[];
}) {
  const { t } = useAppLanguage();
  return (
    <View
      accessibilityRole="tablist"
      style={[styles.detailTabs, desktop && styles.desktopDetailTabs]}
    >
      {analysisTabs
        .filter(
          (tab) =>
            (showSummary || tab.key !== 'summary') &&
            (visibleTabs === undefined || visibleTabs.includes(tab.key)),
        )
        .map((tab) => {
          const selected = tab.key === activeTab;
          return (
            <Pressable
              key={tab.key}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => onChange(tab.key)}
              style={({ pressed }) => [
                styles.detailTab,
                desktop && styles.desktopDetailTab,
                pressed && styles.pressed,
              ]}
            >
              <Text
                style={[
                  styles.detailTabText,
                  desktop && styles.desktopDetailTabText,
                  selected && styles.activeDetailTabText,
                  selected && desktop && styles.desktopActiveDetailTabText,
                ]}
              >
                {tab.key === 'transcript' && transcriptLabel ? transcriptLabel : t(tab.labelKey)}
              </Text>
              <View
                style={[
                  styles.tabUnderline,
                  desktop && styles.desktopTabUnderline,
                  selected && styles.activeTabUnderline,
                ]}
              />
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
  desktopDetailTabs: { gap: spacing.xl, minHeight: 48, paddingHorizontal: spacing.md },
  detailTab: {
    justifyContent: 'flex-end',
  },
  desktopDetailTab: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: spacing.xs,
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
    color: colors.primary,
  },
  desktopDetailTabText: { ...typography.body, paddingBottom: 0, textAlign: 'center' },
  desktopActiveDetailTabText: { ...typography.body, color: colors.primary },
  tabUnderline: {
    backgroundColor: 'transparent',
    height: 2,
  },
  desktopTabUnderline: { bottom: 0, left: 0, position: 'absolute', right: 0 },
  activeTabUnderline: {
    backgroundColor: colors.primary,
  },
});
