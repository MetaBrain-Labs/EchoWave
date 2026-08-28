/**
 * 分析详情总结内容。
 *
 * 呈现 AI 总结标题、生成时间与分段内容，不持有页面状态。
 *
 * Responsibilities:
 * - 封装稳定的展示职责与局部交互。
 * - 页面级状态和导航仍由 AnalysisDetailScreen 统一协调。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, fontFamilies, spacing, textColors, typography } from '@/shared/theme/tokens';
import type { AnalysisDetailView } from '../model';

export function SummaryContent({ detail }: { detail: AnalysisDetailView }) {
  const businessResult = detail.businessAnalysis.result;
  const knowledgeStatusLabel = businessResult
    ? businessResult.knowledgeStatus === 'used'
      ? `已使用 ${businessResult.knowledgeBaseIds.length} 个关联知识库`
      : businessResult.knowledgeStatus === 'linked_not_used'
        ? `已限定 ${businessResult.knowledgeBaseIds.length} 个关联知识库，本次未引用知识块`
        : '当前分组未关联知识库，仅使用确认转写证据'
    : null;
  return (
    <ScrollView
      contentContainerStyle={styles.summaryContent}
      showsVerticalScrollIndicator={false}
      style={styles.pageScroll}
    >
      <Text style={styles.summaryDescription}>AI 智能分析，内容仅供参考</Text>
      <View style={styles.summaryTitleRow}>
        <Ionicons color={colors.success} name="sparkles" size={34} />
        <Text style={styles.summaryTitle}>{detail.title}</Text>
      </View>
      <Text style={styles.generatedAt}>生成时间：{detail.generatedAt}</Text>
      {businessResult ? (
        <Text style={styles.generatedAt}>
          {businessResult.model} · 确认转写 v{businessResult.confirmationVersion}
        </Text>
      ) : null}
      {knowledgeStatusLabel ? (
        <Text style={styles.knowledgeStatus}>{knowledgeStatusLabel}</Text>
      ) : null}
      <View style={styles.summaryDivider} />
      {detail.businessAnalysis.result?.limitations.length ? (
        <View accessibilityRole="alert" style={styles.limitations}>
          <Text style={styles.limitationsTitle}>本次分析限制</Text>
          {detail.businessAnalysis.result.limitations.map((limitation) => (
            <Text key={limitation} style={styles.limitationsBody}>
              • {limitation}
            </Text>
          ))}
        </View>
      ) : null}
      {detail.summarySections.map((section) => (
        <View key={section.id} style={styles.summarySection}>
          <Text style={styles.summarySectionTitle}>{section.title}</Text>
          <Text style={styles.summaryBody}>{section.body}</Text>
        </View>
      ))}
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
});
