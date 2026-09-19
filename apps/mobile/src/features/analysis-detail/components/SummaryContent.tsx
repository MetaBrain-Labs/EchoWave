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
import type { BusinessAnalysisRetrievalCategory } from '@echowave/contracts';
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import type { TranslationKey } from '@/shared/i18n/translations';
import { colors, fontFamilies, spacing, textColors, typography } from '@/shared/theme/tokens';
import { ScreenRefreshControl } from '@/shared/ui/ScreenRefreshControl';
import type { AnalysisDetailView } from '../model';

type TranslationFunction = ReturnType<typeof useAppLanguage>['t'];

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
  const { language, t } = useAppLanguage();
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
  const retrievalCategoryLabel = businessResult
    ? retrievalCategorySummary(businessResult.retrievalCategories, t, language)
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
      {retrievalCategoryLabel ? (
        <Text style={styles.knowledgeStatus}>{retrievalCategoryLabel}</Text>
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

/**
 * 组合“使用分类”摘要行：分类名 + 检索原因 + 命中总数。
 *
 * Notes:
 * - 分类名与分析结果一起冻结，改名的分类在历史报告里仍显示分析当时的名称。
 * - 没有审计（旧报告或未做向量检索）时返回 null，不渲染空行。
 * - 标签接入点：`hitCount` 省略 0 命中段，避免出现“命中 0 条”的噪声。
 */
function retrievalCategorySummary(
  categories: readonly BusinessAnalysisRetrievalCategory[],
  t: TranslationFunction,
  language: 'zh-CN' | 'en',
): string | null {
  if (!categories.length) return null;
  const names = categories.slice(0, 3).map((category) => category.name);
  const remainder = categories.length > names.length ? categories.length - names.length : 0;
  const joined = [
    ...names,
    ...(remainder ? [t('analysis.retrievalMoreCategories', { count: remainder })] : []),
  ].join(language === 'en' ? ', ' : '、');
  const reasonKeys = {
    explicit: 'analysis.retrievalReasonUserFiltered',
    auto: 'analysis.retrievalReasonModelSelected',
    'default-route': 'analysis.retrievalReasonDefaultRoute',
    'zero-hits': 'analysis.retrievalReasonModelSelected',
    'evidence-insufficient': 'analysis.retrievalReasonModelSelected',
  } as const satisfies Record<BusinessAnalysisRetrievalCategory['lookupReason'], TranslationKey>;
  // 多个分类可能来自不同选择方式；只声明最能解释本次范围的单一原因。
  const reason = categories.every((category) => category.lookupReason === 'explicit')
    ? 'explicit'
    : categories.some((category) => category.lookupReason === 'auto')
      ? 'auto'
      : 'default-route';
  const hitCount = categories.reduce((total, category) => total + category.hitCount, 0);
  return [
    t('analysis.retrievalCategories', { categories: joined }),
    t(reasonKeys[reason]),
    ...(hitCount ? [t('analysis.retrievalCategoryHits', { count: hitCount })] : []),
  ].join(' · ');
}

const styles = StyleSheet.create({
  pageScroll: { flex: 1 },
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
