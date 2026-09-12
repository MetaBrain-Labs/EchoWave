/**
 * 分析详情总结内容。
 *
 * 呈现 AI 总结标题、生成时间与分段内容，并处理限制列表的局部展开交互。
 *
 * Responsibilities:
 * - 封装稳定的展示职责与限制列表局部交互。
 * - 页面级状态和导航仍由 AnalysisDetailScreen 统一协调。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import { colors, fontFamilies, spacing, textColors, typography } from '@/shared/theme/tokens';
import { ScreenRefreshControl } from '@/shared/ui/ScreenRefreshControl';
import type { AnalysisDetailView } from '../model';

export type SummaryContentProps = {
  detail: AnalysisDetailView;
  generatedAt?: string;
  leadingContent?: ReactNode;
  limitations?: readonly string[];
  limitationsTitle?: string;
  onRefresh?: () => void;
  recommendations?: readonly string[];
  recommendationsTitle?: string;
  refreshing?: boolean;
};

export function SummaryContent({
  detail,
  generatedAt,
  leadingContent,
  limitations,
  limitationsTitle,
  onRefresh = () => undefined,
  recommendations,
  recommendationsTitle,
  refreshing = false,
}: SummaryContentProps) {
  const { t } = useAppLanguage();
  const [limitationsState, setLimitationsState] = useState({ detailId: '', expanded: false });
  const businessResult = detail.businessAnalysis.result;
  const displayLimitations = limitations ?? businessResult?.limitations ?? [];
  const limitationsExpanded = limitationsState.detailId === detail.id && limitationsState.expanded;
  const knowledgeStatusLabel = businessResult
    ? businessResult.knowledgeStatus === 'used'
      ? t('analysis.knowledgeUsed', { count: businessResult.knowledgeBaseIds.length })
      : businessResult.knowledgeStatus === 'linked_not_used'
        ? t('analysis.knowledgeLinkedNotUsed', {
            count: businessResult.knowledgeBaseIds.length,
          })
        : t('analysis.knowledgeNotLinked')
    : null;
  return (
    <ScrollView
      alwaysBounceVertical
      contentContainerStyle={styles.summaryContent}
      refreshControl={<ScreenRefreshControl onRefresh={onRefresh} refreshing={refreshing} />}
      showsVerticalScrollIndicator={false}
      style={styles.pageScroll}
    >
      {leadingContent}
      <Text style={styles.summaryDescription}>{t('analysis.aiDisclaimer')}</Text>
      <View style={styles.summaryTitleRow}>
        <Ionicons color={colors.success} name="sparkles" size={34} />
        <Text style={styles.summaryTitle}>{detail.title}</Text>
      </View>
      {(generatedAt ?? detail.generatedAt) ? (
        <Text style={styles.generatedAt}>
          {t('analysis.generatedAt', { date: generatedAt ?? detail.generatedAt })}
        </Text>
      ) : null}
      {businessResult ? (
        <Text style={styles.generatedAt}>
          {t('analysis.confirmedVersion', {
            model: businessResult.model,
            version: businessResult.confirmationVersion,
          })}
        </Text>
      ) : null}
      {knowledgeStatusLabel ? (
        <Text style={styles.knowledgeStatus}>{knowledgeStatusLabel}</Text>
      ) : null}
      <View style={styles.summaryDivider} />
      {displayLimitations.length ? (
        <View accessibilityRole="summary" style={styles.limitations}>
          <Pressable
            accessibilityLabel={t(
              limitationsExpanded ? 'analysis.limitationsCollapse' : 'analysis.limitationsExpand',
            )}
            accessibilityRole="button"
            accessibilityState={{ expanded: limitationsExpanded }}
            onPress={() =>
              setLimitationsState({ detailId: detail.id, expanded: !limitationsExpanded })
            }
            style={styles.limitationsHeader}
          >
            <Text style={styles.limitationsTitle}>
              {limitationsTitle ?? t('analysis.limitations')}
            </Text>
            <Ionicons
              color={textColors.primary}
              name={limitationsExpanded ? 'chevron-up' : 'chevron-down'}
              size={20}
            />
          </Pressable>
          {limitationsExpanded
            ? displayLimitations.map((limitation) => (
                <Text key={limitation} style={styles.limitationsBody}>
                  • {limitation}
                </Text>
              ))
            : null}
        </View>
      ) : null}
      {detail.summarySections.map((section) => (
        <View key={section.id} style={styles.summarySection}>
          <Text style={styles.summarySectionTitle}>{section.title}</Text>
          <Text style={styles.summaryBody}>{section.body}</Text>
        </View>
      ))}
      {recommendations?.length ? (
        <View accessibilityRole="summary" style={styles.recommendations}>
          <Text style={styles.summarySectionTitle}>
            {recommendationsTitle ?? t('analysis.recommendations')}
          </Text>
          {recommendations.map((recommendation) => (
            <Text key={recommendation} style={styles.summaryBody}>
              • {recommendation}
            </Text>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pageScroll: {
    flex: 1,
  },
  summaryContent: {
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
  },
  summaryDescription: {
    ...typography.description,
    color: textColors.tertiary,
    fontFamily: fontFamilies.sans,
    textAlign: 'center',
  },
  summaryTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.xl,
  },
  summaryTitle: {
    ...typography.contentDisplay,
    color: textColors.primary,
    flex: 1,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  generatedAt: {
    ...typography.description,
    color: textColors.tertiary,
    fontFamily: fontFamilies.sans,
    marginTop: spacing.xl,
  },
  knowledgeStatus: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    marginTop: spacing.sm,
  },
  summaryDivider: {
    backgroundColor: colors.divider,
    height: StyleSheet.hairlineWidth,
    marginBottom: spacing.xl,
    marginTop: spacing.lg,
  },
  summarySection: {
    marginBottom: spacing.xl,
  },
  limitations: {
    backgroundColor: colors.background,
    borderRadius: 4,
    marginBottom: spacing.xl,
    padding: spacing.md,
  },
  limitationsHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  limitationsTitle: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  limitationsBody: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    marginTop: spacing.xs,
  },
  summarySectionTitle: {
    ...typography.heading2,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
    marginBottom: spacing.sm,
  },
  summaryBody: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sans,
  },
  recommendations: { marginBottom: spacing.xl },
});
