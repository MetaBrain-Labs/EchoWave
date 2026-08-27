/**
 * 单条转写的丰富情绪分析面板。
 *
 * 以底部抽屉展示 Qwen 声学判断的稳定分类、置信度和声音线索。
 *
 * Responsibilities:
 * - 将契约枚举本地化为中文。
 * - 在原始时间线之外提供可关闭的可访问详情。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';
import type { TranscriptSegment } from '../model';

const labels: Record<string, string> = {
  neutral: '平静',
  happy: '愉快',
  sad: '悲伤',
  angry: '生气',
  anxious: '焦虑',
  excited: '兴奋',
  impatient: '不耐烦',
  frustrated: '沮丧',
  sarcastic: '讽刺',
  other: '其他',
  unknown: '未知',
  cooperative: '配合',
  engaged: '投入',
  dismissive: '敷衍',
  resistant: '抵触',
  hesitant: '犹豫',
  assertive: '坚定',
  low: '低',
  medium: '中',
  high: '高',
  slow: '慢',
  normal: '正常',
  fast: '快',
  variable: '变化明显',
  elevated: '提高',
  rising: '上升',
  falling: '下降',
  few: '较少',
  frequent: '频繁',
  long: '长停顿',
  irregular: '不规律',
};

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{labels[value] ?? value}</Text>
    </View>
  );
}

/** 展示选中片段的声学情绪详情。 */
export function EmotionAnalysisPanel({
  segment,
  onClose,
}: {
  segment?: TranscriptSegment;
  onClose: () => void;
}) {
  const analysis = segment?.emotionAnalysis;
  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={Boolean(analysis)}>
      <Pressable accessibilityLabel="关闭情绪分析详情" onPress={onClose} style={styles.backdrop} />
      <SafeAreaView edges={['bottom']} style={styles.sheet}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={styles.title}>
            情绪分析详情
          </Text>
          <Pressable accessibilityLabel="关闭" onPress={onClose}>
            <Ionicons color={colors.ink} name="close" size={24} />
          </Pressable>
        </View>
        {analysis ? (
          <ScrollView contentContainerStyle={styles.content}>
            <DetailRow label="主情绪" value={analysis.label} />
            <DetailRow label="置信度" value={`${Math.round(analysis.confidence * 100)}%`} />
            <DetailRow label="态度" value={analysis.attitude} />
            <DetailRow label="唤醒度" value={analysis.arousal} />
            <DetailRow label="语速" value={analysis.pace} />
            <DetailRow label="音量趋势" value={analysis.volumeTrend} />
            <DetailRow label="音高变化" value={analysis.pitchVariation} />
            <DetailRow label="停顿模式" value={analysis.pausePattern} />
            <Text style={styles.cueTitle}>声音线索</Text>
            {analysis.vocalCues.length ? (
              analysis.vocalCues.map((cue) => (
                <Text key={cue} style={styles.cue}>
                  • {cue}
                </Text>
              ))
            ) : (
              <Text style={styles.cue}>暂无明确声音线索</Text>
            )}
            <Text style={styles.model}>模型：{analysis.model}</Text>
          </ScrollView>
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(16, 24, 40, 0.28)', flex: 1 },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radii.default,
    borderTopRightRadius: radii.default,
    maxHeight: '72%',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 56,
    paddingHorizontal: spacing.md,
  },
  title: { ...typography.heading2, color: textColors.primary, fontFamily: fontFamilies.sansBold },
  content: { paddingBottom: spacing.xl, paddingHorizontal: spacing.md },
  row: {
    borderBottomColor: colors.divider,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.base,
  },
  label: { ...typography.body, color: textColors.secondary, fontFamily: fontFamilies.sans },
  value: { ...typography.body, color: textColors.primary, fontFamily: fontFamilies.sansBold },
  cueTitle: {
    ...typography.heading3,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    marginTop: spacing.lg,
  },
  cue: {
    ...typography.body,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    marginTop: spacing.sm,
  },
  model: {
    ...typography.label,
    color: textColors.tertiary,
    fontFamily: fontFamilies.sans,
    marginTop: spacing.lg,
  },
});
