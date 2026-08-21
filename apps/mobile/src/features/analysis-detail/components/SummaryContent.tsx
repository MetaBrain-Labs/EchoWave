/**
 * 分析详情总结内容。
 *
 * 呈现 AI 总结标题、生成时间与分段内容，不持有页面状态。
 *
 * Responsibilities:
 * - 封装稳定的展示职责与局部交互。
 * - 页面级状态和导航仍由 AnalysisDetailScreen 统一协调。
 */
import Ionicons from "@expo/vector-icons/Ionicons";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import {
  colors,
  fontFamilies,
  spacing,
  textColors,
  typography,
} from "@/shared/theme/tokens";
import type { AnalysisDetailView } from "../model";

export function SummaryContent({
  detail,
}: {
  detail: AnalysisDetailView;
}) {
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
      <View style={styles.summaryDivider} />
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
  summaryDivider: {
    backgroundColor: colors.divider,
    height: StyleSheet.hairlineWidth,
    marginBottom: spacing.xl,
    marginTop: spacing.lg,
  },
  summarySection: {
    marginBottom: spacing.xl,
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
