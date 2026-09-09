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

import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import type { TranslationKey } from '@/shared/i18n/translations';
import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';
import type { TranscriptSegment } from '../model';

const labelKeys: Record<string, TranslationKey> = {
  neutral: 'emotion.neutral',
  happy: 'emotion.happy',
  sad: 'emotion.sad',
  angry: 'emotion.angry',
  anxious: 'emotion.anxious',
  excited: 'emotion.excited',
  impatient: 'emotion.impatient',
  frustrated: 'emotion.frustrated',
  sarcastic: 'emotion.sarcastic',
  other: 'emotion.other',
  unknown: 'emotion.unknown',
  cooperative: 'emotion.cooperative',
  engaged: 'emotion.engaged',
  dismissive: 'emotion.dismissive',
  resistant: 'emotion.resistant',
  hesitant: 'emotion.hesitant',
  assertive: 'emotion.assertive',
  low: 'emotion.low',
  medium: 'emotion.medium',
  high: 'emotion.high',
  slow: 'emotion.slow',
  normal: 'emotion.normal',
  fast: 'emotion.fast',
  variable: 'emotion.variable',
  elevated: 'emotion.elevated',
  rising: 'emotion.rising',
  falling: 'emotion.falling',
  few: 'emotion.few',
  frequent: 'emotion.frequent',
  long: 'emotion.long',
  irregular: 'emotion.irregular',
};

function DetailRow({ label, value }: { label: string; value: string }) {
  const { t } = useAppLanguage();
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{labelKeys[value] ? t(labelKeys[value]) : value}</Text>
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
  const { t } = useAppLanguage();
  const analysis = segment?.emotionAnalysis;
  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={Boolean(analysis)}>
      <Pressable
        accessibilityLabel={t('emotion.detailTitle')}
        onPress={onClose}
        style={styles.backdrop}
      />
      <SafeAreaView edges={['bottom']} style={styles.sheet}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={styles.title}>
            {t('emotion.detailTitle')}
          </Text>
          <Pressable accessibilityLabel={t('common.close')} onPress={onClose}>
            <Ionicons color={colors.ink} name="close" size={24} />
          </Pressable>
        </View>
        {analysis ? (
          <ScrollView contentContainerStyle={styles.content}>
            <DetailRow label={t('emotion.primary')} value={analysis.label} />
            <DetailRow
              label={t('emotion.confidence')}
              value={`${Math.round(analysis.confidence * 100)}%`}
            />
            <DetailRow label={t('emotion.attitude')} value={analysis.attitude} />
            <DetailRow label={t('emotion.arousal')} value={analysis.arousal} />
            <DetailRow label={t('emotion.pace')} value={analysis.pace} />
            <DetailRow label={t('emotion.volumeTrend')} value={analysis.volumeTrend} />
            <DetailRow label={t('emotion.pitchVariation')} value={analysis.pitchVariation} />
            <DetailRow label={t('emotion.pausePattern')} value={analysis.pausePattern} />
            <Text style={styles.cueTitle}>{t('emotion.vocalCues')}</Text>
            {analysis.vocalCues.length ? (
              analysis.vocalCues.map((cue) => (
                <Text key={cue} style={styles.cue}>
                  • {cue}
                </Text>
              ))
            ) : (
              <Text style={styles.cue}>{t('emotion.noCues')}</Text>
            )}
            <Text style={styles.model}>{t('emotion.model', { model: analysis.model })}</Text>
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
