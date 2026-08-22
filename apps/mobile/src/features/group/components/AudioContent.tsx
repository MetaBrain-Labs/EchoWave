/**
 * 分组音频标签页内容。
 *
 * 呈现音频列表及完成、等待、上传、分析中的状态。
 *
 * Responsibilities:
 * - 只负责本标签页的内容渲染与局部交互。
 * - 由 GroupScreen 持有分页、导航和远端加载状态。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type { AudioFileSummary, AudioProcessingStatus } from '@echowave/contracts';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';
function formatDuration(durationMs: number | null) {
  if (durationMs === null) return '--:--';
  const seconds = Math.floor(durationMs / 1_000);
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

function AudioStatusView({
  durationMs,
  status,
}: {
  durationMs: number | null;
  status: AudioProcessingStatus;
}) {
  switch (status.kind) {
    case 'ready':
      return <Text style={styles.statusText}>{formatDuration(durationMs)}</Text>;
    case 'waiting':
      return (
        <View style={styles.inlineStatus}>
          <Ionicons
            color={colors.ink}
            name="hourglass-outline"
            size={typography.label.lineHeight}
          />
          <Text style={styles.statusText}>待分析</Text>
        </View>
      );
    case 'uploading':
      return (
        <View style={styles.inlineStatus}>
          <ActivityIndicator color={colors.ink} size={typography.label.lineHeight} />
          <Text style={styles.statusText}>上传中</Text>
        </View>
      );
    case 'analyzing':
      return <Text style={styles.statusText}>分析中 ({status.progress}%)</Text>;
    case 'transcribing':
      return <Text style={styles.statusText}>转写中 ({status.progress}%)</Text>;
    case 'failed':
      return (
        <Text accessibilityRole="alert" style={styles.statusText}>
          {status.message}
        </Text>
      );
  }
}

function AudioCard({
  item,
  onOpenAudio,
}: {
  item: AudioFileSummary;
  onOpenAudio?: (id: string) => void;
}) {
  const content = (
    <>
      <Text style={styles.cardTitle}>{item.title}</Text>
      <View style={styles.audioMetaRow}>
        <Text style={styles.metaText}>时间 {new Date(item.createdAt).toLocaleString()}</Text>
        <AudioStatusView durationMs={item.durationMs} status={item.status} />
      </View>
      {item.sharedFrom ? (
        <View style={styles.sharedRow}>
          <Ionicons
            color={colors.muted}
            name="swap-horizontal"
            size={typography.label.lineHeight}
          />
          <Text style={styles.metaText}>来自 {item.sharedFrom}</Text>
        </View>
      ) : null}
    </>
  );

  if (item.status.kind !== 'ready') {
    return <View style={styles.card}>{content}</View>;
  }

  return (
    <Pressable
      accessibilityHint="打开该音频的分析详情"
      accessibilityLabel={`${item.title}，分析已完成`}
      accessibilityRole="button"
      onPress={() => onOpenAudio?.(item.id)}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

export function AudioContent({
  error,
  emptyMessage,
  items,
  loading,
  onOpenFilter,
  onOpenAudio,
  onRetry,
}: {
  error: string;
  emptyMessage: string;
  items: AudioFileSummary[];
  loading: boolean;
  onOpenFilter: () => void;
  onOpenAudio?: (id: string) => void;
  onRetry: () => void;
}) {
  if (loading) {
    return <ActivityIndicator accessibilityLabel="正在加载分组音频" color={colors.ink} />;
  }
  if (error) {
    return (
      <View style={styles.card}>
        <Text accessibilityRole="alert" style={styles.metaText}>
          {error}
        </Text>
        <Pressable accessibilityRole="button" onPress={onRetry}>
          <Text style={styles.filterText}>重新加载</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>共 {items.length} 份音频</Text>
        <Pressable
          accessibilityLabel="排序筛选"
          accessibilityRole="button"
          onPress={onOpenFilter}
          style={({ pressed }) => [styles.filterButton, pressed && styles.pressed]}
        >
          <Text style={styles.filterText}>排序筛选</Text>
          <Ionicons
            color={colors.secondary}
            name="filter-outline"
            size={typography.heading5.lineHeight}
          />
        </Pressable>
      </View>
      {items.length ? (
        items.map((item) => <AudioCard key={item.id} item={item} onOpenAudio={onOpenAudio} />)
      ) : (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>{emptyMessage}</Text>
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  pressed: {
    backgroundColor: colors.background,
    borderRadius: radii.default,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    ...typography.heading2,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  filterButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 40,
  },
  filterText: {
    ...typography.heading5,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.base,
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.035,
    shadowRadius: 5,
  },
  emptyState: {
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xl,
  },
  emptyText: {
    ...typography.body,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    textAlign: 'center',
  },
  cardTitle: {
    ...typography.heading2,
    color: textColors.primary,
    flexShrink: 1,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  audioMetaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  metaText: {
    ...typography.label,
    color: textColors.tertiary,
    fontFamily: fontFamilies.sans,
  },
  statusText: {
    ...typography.label,
    color: textColors.primary,
    fontFamily: fontFamilies.sans,
  },
  inlineStatus: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  sharedRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
});
