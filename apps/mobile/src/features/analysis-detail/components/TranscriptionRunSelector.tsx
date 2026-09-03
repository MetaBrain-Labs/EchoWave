/**
 * ASR Run 版本选择器。
 *
 * 展示同一音频的不可变转写版本、声学开关和当前选择策略，并允许固定旧版本或恢复自动跟随最新成功版本。
 *
 * Responsibilities:
 * - 明确区分 Run 状态、是否启用声学情绪和当前 active 指针。
 * - 把选择动作交给页面编排器执行。
 */
import type { AudioTranscriptionRunListResponse } from '@echowave/contracts';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';

/** 渲染 ASR 版本列表和自动选择入口。 */
export function TranscriptionRunSelector({
  onAuto,
  onSelect,
  pending,
  runs,
}: {
  onAuto: () => void;
  onSelect: (revisionId: string) => void;
  pending: boolean;
  runs?: AudioTranscriptionRunListResponse;
}) {
  if (!runs) return null;
  return (
    <View style={styles.container}>
      <View style={styles.headingRow}>
        <View style={styles.copy}>
          <Text style={styles.title}>ASR 版本</Text>
          <Text style={styles.description}>
            {runs.selectionMode === 'auto' ? '自动使用最新成功版本' : '已手动固定版本'}
          </Text>
        </View>
        {runs.selectionMode === 'manual' ? (
          <Pressable disabled={pending} onPress={onAuto} style={styles.autoAction}>
            <Text style={styles.actionText}>恢复自动</Text>
          </Pressable>
        ) : null}
      </View>
      {runs.items.map((run) => (
        <Pressable
          accessibilityRole="radio"
          accessibilityState={{ checked: run.active, disabled: pending || run.status !== 'ready' }}
          disabled={pending || run.status !== 'ready'}
          key={run.id}
          onPress={() => onSelect(run.id)}
          style={[styles.run, run.active && styles.activeRun]}
        >
          <View style={styles.copy}>
            <Text style={styles.runTitle}>
              v{run.revision} · {run.model}
            </Text>
            <Text style={styles.description}>
              {run.status} · 声学情绪{run.includeAcousticEmotion ? '已启用' : '未启用'}
            </Text>
          </View>
          <Text style={styles.marker}>{run.active ? '当前' : '选择'}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.card,
    borderRadius: radii.default,
    gap: spacing.sm,
    padding: spacing.md,
  },
  headingRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  copy: { flex: 1 },
  title: { ...typography.heading2, color: textColors.primary, fontFamily: fontFamilies.sansBold },
  runTitle: { ...typography.body, color: textColors.primary, fontFamily: fontFamilies.sansBold },
  description: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    marginTop: spacing.xs,
  },
  run: {
    alignItems: 'center',
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.base,
  },
  activeRun: { borderColor: colors.ink, borderWidth: 2 },
  marker: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sansBold,
  },
  autoAction: { padding: spacing.sm },
  actionText: {
    ...typography.description,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
  },
});
