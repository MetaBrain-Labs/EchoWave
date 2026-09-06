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
import type { AudioFileSummary, AudioProcessingStatus, TemplateExample } from '@echowave/contracts';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';
import { useStarterTourTarget } from '@/shared/onboarding/StarterTourContext';
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
  onOpenAudio,
  onOpenFilter,
  onRetry,
  onOpenTemplateExample,
  onRetryTemplateExample,
  templateExample,
  templateExampleError,
  templateExampleLoading,
}: {
  error: string;
  emptyMessage: string;
  items: AudioFileSummary[];
  loading: boolean;
  onOpenAudio?: (id: string) => void;
  onOpenFilter: () => void;
  onRetry: () => void;
  onOpenTemplateExample?: () => void;
  onRetryTemplateExample: () => void;
  templateExample?: TemplateExample;
  templateExampleError: string;
  templateExampleLoading: boolean;
}) {
  return (
    <>
      <TemplateExampleCard
        error={templateExampleError}
        example={templateExample}
        loading={templateExampleLoading}
        onOpen={onOpenTemplateExample}
        onRetry={onRetryTemplateExample}
      />
      {loading ? (
        <ActivityIndicator accessibilityLabel="正在加载分组音频" color={colors.ink} />
      ) : error ? (
        <View style={styles.card}>
          <Text accessibilityRole="alert" style={styles.metaText}>{error}</Text>
          <Pressable accessibilityRole="button" onPress={onRetry}>
            <Text style={styles.filterText}>重新加载</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>共 {items.length} 份音频</Text>
            <Pressable accessibilityLabel="音频排序筛选" accessibilityRole="button"
              onPress={onOpenFilter} style={({ pressed }) => [styles.filterButton, pressed && styles.pressed]}>
              <Text style={styles.filterText}>排序筛选</Text>
              <Ionicons color={colors.secondary} name="filter-outline" size={typography.heading5.lineHeight} />
            </Pressable>
          </View>
          {items.length ? items.map((item) => <AudioCard key={item.id} item={item} onOpenAudio={onOpenAudio} />) : (
            <View style={styles.emptyState}><Text style={styles.emptyText}>{emptyMessage}</Text></View>
          )}
        </>
      )}
    </>
  );
}

/** 独立呈现不计入真实音频统计的模板示例入口。 */
function TemplateExampleCard({
  error,
  example,
  loading,
  onOpen,
  onRetry,
}: {
  error: string;
  example?: TemplateExample;
  loading: boolean;
  onOpen?: () => void;
  onRetry: () => void;
}) {
  const tourRef = useStarterTourTarget('group-template-example');
  if (!loading && !error && !example) return null;
  return (
    <View collapsable={false} ref={tourRef} style={styles.exampleRegion}>
      <View style={styles.exampleHeadingRow}>
        <Text style={styles.exampleHeading}>模板示例</Text>
        <Text style={styles.exampleBadge}>只读示例</Text>
      </View>
      {loading ? (
        <ActivityIndicator accessibilityLabel="正在加载模板示例" color={colors.ink} />
      ) : error ? (
        <View style={styles.exampleErrorRow}>
          <Text accessibilityRole="alert" style={styles.metaText}>
            {error}
          </Text>
          <Pressable accessibilityRole="button" onPress={onRetry}>
            <Text style={styles.filterText}>重试</Text>
          </Pressable>
        </View>
      ) : example ? (
        <Pressable
          accessibilityHint="打开不包含原始音频的只读分析示例"
          accessibilityRole="button"
          onPress={onOpen}
          style={({ pressed }) => [styles.exampleCard, pressed && styles.pressed]}
        >
          <View style={styles.exampleCopy}>
            <Text style={styles.cardTitle}>{example.title}</Text>
            <Text numberOfLines={2} style={styles.exampleDescription}>
              {example.scenario}
            </Text>
          </View>
          <Ionicons color={colors.ink} name="arrow-forward" size={22} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  exampleRegion: { marginBottom: spacing.xl },
  exampleHeadingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  exampleHeading: {
    ...typography.heading3,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  exampleBadge: {
    ...typography.label,
    backgroundColor: colors.background,
    borderRadius: radii.default,
    color: textColors.secondary,
    overflow: 'hidden',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  exampleCard: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.ink,
    borderLeftWidth: 3,
    borderRadius: radii.default,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  exampleCopy: { flex: 1, gap: spacing.xs },
  exampleDescription: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  exampleErrorRow: { gap: spacing.sm },
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
    padding: spacing.md,
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
