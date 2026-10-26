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
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { listAudioAnalysisRuns } from '@/shared/api/audioAnalysisRunsApi';
import { useScreenRefresh } from '@/shared/hooks/useScreenRefresh';
import { LoadingIndicator } from '@/shared/ui/LoadingIndicator';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import type { TranslationKey } from '@/shared/i18n/translations';
import { colors, radii, spacing, textColors, typography } from '@/shared/theme/tokens';
import { DesktopDataTable } from '@/shared/ui/DesktopDataTable';
import { StatusBadge } from '@/shared/ui/DesignPrimitives';
import { TopLevelPageHeader } from '@/shared/ui/TopLevelPageHeader';
import { ScreenRefreshControl } from '@/shared/ui/ScreenRefreshControl';
import { useResponsiveLayout } from '@/shared/ui/useResponsiveLayout';

const filters = [
  ['all', 'analysisRuns.filter.all'],
  ['active', 'analysisRuns.filter.active'],
  ['completed', 'analysisRuns.filter.completed'],
  ['warning', 'analysisRuns.filter.warning'],
  ['failed', 'analysisRuns.filter.failed'],
  ['canceled', 'analysisRuns.filter.canceled'],
] as const;

function statusLabelKey(status: AudioAnalysisRun['status']): TranslationKey {
  const keys: Record<AudioAnalysisRun['status'], TranslationKey> = {
    awaiting_upload: 'batchDetail.status.awaiting_upload',
    scheduled: 'analysisRuns.status.scheduled',
    queued: 'analysisRuns.status.queued',
    running: 'analysisRuns.status.running',
    hard_blocked: 'analysisRuns.status.hardBlocked',
    completed: 'batchDetail.status.completed',
    completed_with_warnings: 'batchDetail.status.completed_with_warnings',
    failed: 'batchDetail.status.failed',
    canceled: 'batchDetail.status.canceled',
  };
  return keys[status];
}

function isActive(run: AudioAnalysisRun): boolean {
  return ['awaiting_upload', 'scheduled', 'queued', 'running'].includes(run.status);
}

/** 渲染统一分析运行记录。 */
export function AnalysisRunsScreen({ onBack }: { onBack?: () => void } = {}) {
  const { formatDateTime, t } = useAppLanguage();
  const { desktop } = useResponsiveLayout();
  const router = useRouter();
  const [filter, setFilter] = useState<(typeof filters)[number][0]>('all');
  const [items, setItems] = useState<AudioAnalysisRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (showLoading = true) => {
      if (showLoading) setLoading(true);
      try {
        const response = await listAudioAnalysisRuns({ status: filter, kind: 'all', limit: 50 });
        setItems(response.items);
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : t('analysisRuns.loadFailed'));
      } finally {
        setLoading(false);
      }
    },
    [filter, t],
  );

  const screenRefresh = useScreenRefresh(() => load(false));

  useEffect(() => {
    const task = setTimeout(() => void load(), 0);
    return () => clearTimeout(task);
  }, [load]);

  useEffect(() => {
    const hasActive = items.some(isActive);
    if (!hasActive) return undefined;
    const timer = setInterval(() => void load(false), 15_000);
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

  const tableColumns = [
    {
      id: 'run',
      label: t('tabs.analysis'),
      flex: 2,
      render: (run: AudioAnalysisRun) => (
        <View style={styles.tableRun}>
          <Text numberOfLines={1} style={styles.title}>
            {run.title}
          </Text>
          <Text numberOfLines={2} style={styles.meta}>
            {run.kind === 'batch' ? t('analysisRuns.batchCounts', run.counts) : t('tabs.analysis')}
          </Text>
        </View>
      ),
    },
    {
      id: 'status',
      label: t('desktop.sourceStatus'),
      width: 150,
      render: (run: AudioAnalysisRun) => (
        <StatusBadge
          label={t(statusLabelKey(run.status))}
          tone={
            run.status === 'completed'
              ? 'success'
              : run.status === 'failed'
                ? 'danger'
                : run.status === 'completed_with_warnings'
                  ? 'warning'
                  : 'neutral'
          }
        />
      ),
    },
    {
      id: 'progress',
      label: t('desktop.runProgress'),
      width: 92,
      render: (run: AudioAnalysisRun) => <Text style={styles.meta}>{run.progress}%</Text>,
    },
    {
      id: 'details',
      label: t('desktop.runDetails'),
      flex: 1.4,
      render: (run: AudioAnalysisRun) => (
        <Text
          numberOfLines={2}
          style={
            run.kind === 'manual_audio' && run.warningCodes.length ? styles.warning : styles.meta
          }
        >
          {run.kind === 'batch'
            ? t('analysisRuns.batchCounts', run.counts)
            : run.warningCodes.length
              ? t('analysisRuns.limited', { codes: run.warningCodes.join('、') })
              : t(statusLabelKey(run.status))}
        </Text>
      ),
    },
    {
      id: 'updated',
      label: t('desktop.updated'),
      width: 160,
      render: (run: AudioAnalysisRun) => (
        <Text numberOfLines={1} style={styles.meta}>
          {formatDateTime(run.updatedAt)}
        </Text>
      ),
    },
  ];

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safeArea, desktop && styles.desktopSafeArea]}
      testID="analysis-runs-screen"
    >
      <TopLevelPageHeader
        onBack={onBack}
        subtitle={t('analysisRuns.subtitle')}
        title={t('tabs.analysis')}
      />
      <View style={styles.filters}>
        {filters.map(([value, label]) => (
          <Pressable
            accessibilityRole="button"
            key={value}
            onPress={() => setFilter(value)}
            style={[styles.filter, filter === value && styles.filterActive]}
          >
            <Text style={[styles.filterText, filter === value && styles.filterTextActive]}>
              {t(label)}
            </Text>
          </Pressable>
        ))}
      </View>
      {loading ? (
        <View style={styles.center}>
          <LoadingIndicator accessibilityLabel={t('common.loading')} />
        </View>
      ) : error && !items.length ? (
        <ScrollView
          alwaysBounceVertical
          contentContainerStyle={styles.center}
          refreshControl={<ScreenRefreshControl {...screenRefresh} />}
        >
          <Text style={styles.error}>{error}</Text>
          <Pressable onPress={() => void load()} style={styles.retry}>
            <Text style={styles.retryText}>{t('common.retry')}</Text>
          </Pressable>
        </ScrollView>
      ) : (
        <ScrollView
          alwaysBounceVertical
          contentContainerStyle={[
            items.length ? styles.content : styles.emptyContent,
            desktop && styles.desktopContent,
          ]}
          refreshControl={<ScreenRefreshControl {...screenRefresh} />}
        >
          {error ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {t('analysisRuns.refreshFailed', { message: error })}
            </Text>
          ) : null}
          {items.length && desktop ? (
            <DesktopDataTable
              columns={tableColumns}
              getRowAccessibilityLabel={(run) => run.title}
              getRowKey={(run) => `${run.kind}-${run.id}`}
              label={t('tabs.analysis')}
              onRowPress={open}
              rows={items}
              testID="desktop-analysis-runs-table"
            />
          ) : items.length && !desktop ? (
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
                    {t(statusLabelKey(run.status))} · {run.progress}%
                  </Text>
                  {run.kind === 'batch' ? (
                    <Text style={styles.meta}>{t('analysisRuns.batchCounts', run.counts)}</Text>
                  ) : run.warningCodes.length ? (
                    <Text style={styles.warning}>
                      {t('analysisRuns.limited', { codes: run.warningCodes.join('、') })}
                    </Text>
                  ) : null}
                </View>
                <Ionicons color={textColors.tertiary} name="chevron-forward" size={20} />
              </Pressable>
            ))
          ) : (
            <Text style={styles.empty}>{t('analysisRuns.empty')}</Text>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.canvas, flex: 1 },
  desktopSafeArea: { backgroundColor: 'transparent' },
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
  desktopContent: { padding: spacing.xl },
  tableRun: { gap: spacing.xs },
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
