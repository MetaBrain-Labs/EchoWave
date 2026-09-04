/**
 * 分析工作区列表页。
 *
 * 统一展示一键式批次和手动单音频分析，支持状态筛选、下拉刷新、失败重试和详情跳转。
 *
 * Responsibilities:
 * - 在页面获得焦点时加载并每 15 秒刷新运行中记录。
 * - 将批次与手动记录导航到各自的详情页。
 *
 * Notes:
 * - 列表是服务端只读聚合，取消和恢复操作在批次详情页完成。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type { AudioAnalysisRun } from '@echowave/contracts';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { listAudioAnalysisRuns } from '@/shared/api/audioAnalysisRunsApi';
import { colors, radii, spacing, textColors, typography } from '@/shared/theme/tokens';
import { TopLevelPageHeader } from '@/shared/ui/TopLevelPageHeader';

const filters = [
  ['all', '全部'],
  ['active', '进行中'],
  ['completed', '已完成'],
  ['failed', '失败'],
  ['canceled', '已取消'],
] as const;

function statusLabel(status: AudioAnalysisRun['status']): string {
  return {
    awaiting_upload: '等待上传',
    scheduled: '已定时',
    queued: '排队中',
    running: '运行中',
    hard_blocked: '已阻塞',
    completed: '已完成',
    completed_with_warnings: '完成但有限制',
    failed: '失败',
    canceled: '已取消',
  }[status];
}

function isActive(run: AudioAnalysisRun): boolean {
  return ['awaiting_upload', 'scheduled', 'queued', 'running'].includes(run.status);
}

/** 渲染统一分析运行记录。 */
export function AnalysisRunsScreen({ onBack }: { onBack?: () => void } = {}) {
  const router = useRouter();
  const [filter, setFilter] = useState<(typeof filters)[number][0]>('all');
  const [items, setItems] = useState<AudioAnalysisRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (mode === 'refresh') setRefreshing(true);
      else setLoading(true);
      try {
        const response = await listAudioAnalysisRuns({ status: filter, kind: 'all', limit: 50 });
        setItems(response.items);
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '分析记录加载失败。');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [filter],
  );

  useFocusEffect(
    useCallback(() => {
      void load();
      return undefined;
    }, [load]),
  );

  useEffect(() => {
    const hasActive = items.some(isActive);
    if (!hasActive) return undefined;
    const timer = setInterval(() => void load('refresh'), 15_000);
    return () => clearInterval(timer);
  }, [items, load]);

  const open = (run: AudioAnalysisRun) => {
    if (run.kind === 'batch') {
      router.push({ pathname: '/analysis-batches/[id]', params: { id: run.id } });
    } else {
      router.push({
        pathname: '/analysis/[id]',
        params: { id: run.audioFileId, ...(run.groupId ? { groupId: run.groupId } : {}) },
      });
    }
  };

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <TopLevelPageHeader onBack={onBack} subtitle="查看所有音频分析流程与报告" title="分析" />
      <View style={styles.filters}>
        {filters.map(([value, label]) => (
          <Pressable
            accessibilityRole="button"
            key={value}
            onPress={() => setFilter(value)}
            style={[styles.filter, filter === value && styles.filterActive]}
          >
            <Text style={[styles.filterText, filter === value && styles.filterTextActive]}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.ink} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
          <Pressable onPress={() => void load()} style={styles.retry}>
            <Text style={styles.retryText}>重试</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={items.length ? styles.content : styles.emptyContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void load('refresh')} />
          }
        >
          {items.length ? (
            items.map((run) => (
              <Pressable
                key={`${run.kind}-${run.id}`}
                onPress={() => open(run)}
                style={styles.card}
              >
                <View style={styles.icon}>
                  <Ionicons
                    color={colors.ink}
                    name={run.kind === 'batch' ? 'albums-outline' : 'musical-notes-outline'}
                    size={21}
                  />
                </View>
                <View style={styles.copy}>
                  <Text numberOfLines={1} style={styles.title}>
                    {run.title}
                  </Text>
                  <Text style={styles.meta}>
                    {statusLabel(run.status)} · {run.progress}%
                  </Text>
                  {run.kind === 'batch' ? (
                    <Text style={styles.meta}>
                      共 {run.counts.total} 项，完成 {run.counts.completed}，失败{' '}
                      {run.counts.failed}
                    </Text>
                  ) : run.warningCodes.length ? (
                    <Text style={styles.warning}>有限制：{run.warningCodes.join('、')}</Text>
                  ) : null}
                </View>
                <Ionicons color={textColors.tertiary} name="chevron-forward" size={20} />
              </Pressable>
            ))
          ) : (
            <Text style={styles.empty}>暂无分析记录</Text>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.canvas, flex: 1 },
  filters: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  filter: {
    borderColor: colors.divider,
    borderRadius: radii.round,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  filterActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  filterText: { ...typography.description, color: textColors.secondary },
  filterTextActive: { color: colors.white },
  content: { gap: spacing.sm, padding: spacing.md },
  emptyContent: { flexGrow: 1, justifyContent: 'center', padding: spacing.md },
  card: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  icon: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radii.round,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  copy: { flex: 1 },
  title: { ...typography.heading3, color: textColors.primary },
  meta: { ...typography.description, color: textColors.secondary, marginTop: spacing.xs },
  warning: { ...typography.description, color: colors.danger, marginTop: spacing.xs },
  center: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.sm,
    justifyContent: 'center',
    padding: spacing.md,
  },
  error: { ...typography.body, color: colors.danger, textAlign: 'center' },
  retry: {
    backgroundColor: colors.ink,
    borderRadius: radii.round,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  retryText: { ...typography.body, color: colors.white },
  empty: { ...typography.body, color: textColors.secondary, textAlign: 'center' },
});
