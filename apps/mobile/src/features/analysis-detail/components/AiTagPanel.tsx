/**
 * 分析详情 AI 标签面板。
 *
 * 呈现选中转写片段的分析解释，并控制隐藏无关片段偏好入口。
 *
 * Responsibilities:
 * - 封装稳定的展示职责与局部交互。
 * - 页面级状态和导航仍由 AnalysisDetailScreen 统一协调。
 */
import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from "@/shared/theme/tokens";
import type { AiTagAnalysis } from "../mockData";
import { Checkbox } from "./AnalysisControls";
import { formatTime } from "./utils";

export function AiTagPanel({
  analysis,
  audioExpanded,
  endSeconds,
  hideIrrelevant,
  onClose,
  onHideIrrelevantChange,
  startSeconds,
}: {
  analysis: AiTagAnalysis | undefined;
  audioExpanded: boolean;
  endSeconds: number;
  hideIrrelevant: boolean;
  onClose: () => void;
  onHideIrrelevantChange: (value: boolean) => void;
  startSeconds: number;
}) {
  if (!analysis) {
    return null;
  }

  return (
    <View
      accessibilityLabel="AI 标签分析窗口"
      style={[
        styles.sheet,
        audioExpanded ? styles.sheetWithExpandedAudio : styles.sheetWithCompactAudio,
      ]}
      testID="ai-tag-sheet"
    >
      <Pressable
        accessibilityLabel="收起 AI 标签面板"
        accessibilityRole="button"
        onPress={onClose}
        style={({ pressed }) => [styles.sheetHandle, pressed && styles.pressed]}
      >
        <Ionicons color={colors.secondary} name="chevron-down" size={26} />
      </Pressable>
      <View style={styles.sheetFixedHeader} testID="ai-tag-fixed-header">
        <Text style={styles.sheetMeta}>
          AI标签 · 涉及片段 · {formatTime(startSeconds)} ～ {formatTime(endSeconds)}
        </Text>
        <View style={styles.sheetCheckbox}>
          <Checkbox
            checked={hideIrrelevant}
            label="隐藏无关片段"
            onPress={() => onHideIrrelevantChange(!hideIrrelevant)}
          />
        </View>
      </View>
      <ScrollView
        contentContainerStyle={styles.sheetContent}
        showsVerticalScrollIndicator={false}
        style={styles.sheetScroll}
        testID="ai-tag-scroll-content"
      >
        <View style={styles.sheetTitleRow}>
          <Ionicons color={colors.success} name="sparkles" size={34} />
          <Text style={styles.sheetTitle}>{analysis.title}</Text>
        </View>
        <Text style={styles.sheetDescription}>AI 智能分析，内容仅供参考</Text>
        <Text style={styles.analysisParagraphTitle}>分析结论</Text>
        <Text style={styles.analysisParagraph}>{analysis.summary}</Text>
        {analysis.details.map((detail) => (
          <View key={detail} style={styles.analysisDetailRow}>
            <View style={styles.analysisBullet} />
            <Text style={styles.analysisParagraph}>{detail}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: {
    backgroundColor: colors.background,
  },
  sheet: {
    backgroundColor: colors.card,
    borderColor: colors.divider,
    borderTopLeftRadius: radii.default,
    borderTopRightRadius: radii.default,
    borderWidth: StyleSheet.hairlineWidth,
    flexShrink: 1,
    maxWidth: 480,
    width: '100%',
  },
  sheetWithCompactAudio: {
    maxHeight: '50%',
  },
  sheetWithExpandedAudio: {
    maxHeight: '33%',
  },
  sheetHandle: {
    alignItems: 'center',
    minHeight: 40,
    justifyContent: 'center',
  },
  sheetFixedHeader: {
    borderBottomColor: colors.divider,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  sheetScroll: {
    flexShrink: 1,
  },
  sheetContent: {
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.md,
  },
  sheetMeta: {
    ...typography.description,
    color: textColors.tertiary,
    fontFamily: fontFamilies.sans,
    textAlign: 'center',
  },
  sheetCheckbox: {
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  sheetTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  sheetTitle: {
    ...typography.contentDisplay,
    color: textColors.primary,
    flex: 1,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  sheetDescription: {
    ...typography.description,
    color: textColors.tertiary,
    fontFamily: fontFamilies.sans,
    marginLeft: 48,
    marginTop: spacing.xs,
  },
  analysisParagraphTitle: {
    ...typography.heading2,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
    marginTop: spacing.xl,
  },
  analysisParagraph: {
    ...typography.body,
    color: textColors.primary,
    flex: 1,
    fontFamily: fontFamilies.sans,
    marginTop: spacing.sm,
  },
  analysisDetailRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  analysisBullet: {
    backgroundColor: colors.success,
    borderRadius: radii.round,
    height: 8,
    marginTop: spacing.md,
    width: 8,
  },
});

