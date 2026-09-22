/**
 * 智能重排披露行。
 *
 * 在问答回答、历史记录与分析报告里用同一段文案说明本次是否使用了重排及其量化效果。
 *
 * Responsibilities:
 * - 生效时说明模型、候选数、入选证据数、其中来自重排提升的条数与耗时。
 * - 降级时说明原因；未启用或缺少审计时不渲染任何内容。
 *
 * Notes:
 * - 只消费服务端审计字段，不在客户端推断重排是否发生。
 * - 文案里的"重排提升"指重排后入选、而纯向量顺序不会入选的证据条数。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type { RerankDisclosure as RerankDisclosureValue } from '@echowave/contracts';
import { StyleSheet, Text, View } from 'react-native';

import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';

/**
 * 旧服务端响应只有粗粒度状态时，用它合成一份"仅降级"的披露。
 *
 * 生效与关闭状态在缺少审计时不披露，避免在没有候选数的情况下空口声称效果。
 */
export function fallbackRerankDisclosure(retrieval: {
  rerankStatus: 'applied' | 'disabled' | 'fallback';
  rerankerModel: string | null;
}): RerankDisclosureValue | undefined {
  if (retrieval.rerankStatus !== 'fallback') return undefined;
  return {
    status: 'fallback',
    model: retrieval.rerankerModel,
    candidateCount: 0,
    selectedCount: 0,
    promotedCount: 0,
    reordered: false,
    measured: false,
    durationMs: 0,
    tokens: 0,
    fallbackReason: null,
  };
}

/** 渲染一次检索的重排披露；`disabled` 返回 null。 */
export function RerankDisclosure({
  compact = false,
  disclosure,
}: {
  compact?: boolean;
  disclosure: RerankDisclosureValue;
}) {
  const { formatNumber, t } = useAppLanguage();
  if (disclosure.status === 'disabled') return null;
  const degraded = disclosure.status === 'fallback';
  const numbers = {
    model: disclosure.model ?? 'qwen3.7-text-rerank',
    candidates: formatNumber(disclosure.candidateCount),
    selected: formatNumber(disclosure.selectedCount),
    promoted: formatNumber(disclosure.promotedCount),
    duration: `${formatNumber(disclosure.durationMs)} ms`,
  };
  const message = degraded
    ? disclosure.fallbackReason === 'NOT_CONFIGURED'
      ? t('rerank.disclosure.fallbackNotConfigured')
      : t('rerank.degraded')
    : compact && !disclosure.measured
      ? t('rerank.disclosure.compactUnmeasured', numbers)
      : compact
        ? t('rerank.disclosure.compact', numbers)
        : !disclosure.measured
          ? // 旧审计没有效果字段：只能说用了重排，不能声称与向量顺序一致。
            t('rerank.disclosure.appliedUnmeasured', numbers)
          : disclosure.promotedCount > 0
            ? t('rerank.disclosure.applied', numbers)
            : disclosure.reordered
              ? t('rerank.disclosure.appliedReordered', numbers)
              : t('rerank.disclosure.appliedStable', numbers);
  return (
    <View
      accessibilityRole="summary"
      style={[styles.row, degraded ? styles.degradedRow : styles.appliedRow]}
      testID="rerank-disclosure"
    >
      <Ionicons
        color={degraded ? '#8a4b08' : textColors.secondary}
        name={degraded ? 'information-circle-outline' : 'swap-vertical-outline'}
        size={16}
      />
      <Text style={[styles.text, degraded && styles.degradedText]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'flex-start',
    borderRadius: radii.default,
    flexDirection: 'row',
    gap: spacing.xs,
    padding: spacing.sm,
  },
  appliedRow: { backgroundColor: colors.background },
  degradedRow: { backgroundColor: '#fff4e5' },
  text: {
    ...typography.description,
    color: textColors.secondary,
    flex: 1,
    fontFamily: fontFamilies.sans,
  },
  degradedText: { color: '#8a4b08' },
});
