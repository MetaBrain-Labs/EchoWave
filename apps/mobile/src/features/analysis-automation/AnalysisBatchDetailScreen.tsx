/**
 * 自动分析批次详情页。
 *
 * 通过 SSE 显示批次汇总、逐项阶段、警告和硬阻塞；实时流断开时自动降级为 REST 轮询，
 * 并提供单项/整批恢复与取消。
 *
 * Responsibilities:
 * - 呈现数据库权威批次快照和本地时区计划时间。
 * - 执行恢复、取消并在命令完成后刷新最新状态。
 */
import type { AudioAnalysisBatch, AudioAnalysisTask } from '@echowave/contracts';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  cancelAudioAnalysisBatch,
  cancelAudioAnalysisTask,
  getAudioAnalysisBatch,
  resumeAudioAnalysisBatch,
  resumeAudioAnalysisTask,
} from '@/shared/api/audioAutomationApi';
import { remountAudioSource } from '@/shared/api/audioAnalysisApi';
import { pickDocumentAsync } from '@/shared/files/documentPicker';
import { streamAudioAnalysisBatch } from '@/shared/api/liveUpdateStreams';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import { localizeRequestError } from '@/shared/i18n/errorLocalization';
import type { TranslationKey } from '@/shared/i18n/translations';
import { backOrReplace } from '@/shared/navigation/routeBack';
import { useScreenRefresh } from '@/shared/hooks/useScreenRefresh';
import { colors, radii, spacing, textColors, typography } from '@/shared/theme/tokens';
import { PageHeader } from '@/shared/ui/PageHeader';
import { ScreenRefreshControl } from '@/shared/ui/ScreenRefreshControl';

const statusLabelKeys: Record<AudioAnalysisTask['status'], TranslationKey> = {
  awaiting_upload: 'batchDetail.status.awaiting_upload',
  scheduled: 'batchDetail.status.scheduled',
  queued: 'batchDetail.status.queued',
  running: 'batchDetail.status.running',
  hard_blocked: 'batchDetail.status.hard_blocked',
  completed: 'batchDetail.status.completed',
  completed_with_warnings: 'batchDetail.status.completed_with_warnings',
  failed: 'batchDetail.status.failed',
  canceled: 'batchDetail.status.canceled',
};

const phaseLabelKeys: Record<AudioAnalysisTask['phase'], TranslationKey> = {
  upload: 'batchDetail.phase.upload',
  transcription: 'batchDetail.phase.transcription',
  post_analysis: 'batchDetail.phase.post_analysis',
  business_analysis: 'batchDetail.phase.business_analysis',
  done: 'batchDetail.phase.done',
};

type DetailRouter = Parameters<typeof backOrReplace>[0];

/** 渲染可恢复的批次运行详情。 */
export function AnalysisBatchDetailScreen({
  batchId,
  router,
}: {
  batchId: string;
  router: DetailRouter;
}) {
  const { formatDateTime, t } = useAppLanguage();
  const [batch, setBatch] = useState<AudioAnalysisBatch>();
  const [error, setError] = useState('');
  const [restFallback, setRestFallback] = useState(false);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      setBatch(await getAudioAnalysisBatch(batchId));
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('analysisBatch.loadFailed'));
      throw reason;
    }
  }
  const screenRefresh = useScreenRefresh(async () => {
    await refresh().catch(() => undefined);
  });

  useEffect(() => {
    const controller = new AbortController();
    let fallbackTimer: ReturnType<typeof setInterval> | undefined;
    void getAudioAnalysisBatch(batchId)
      .then((nextBatch) => {
        setBatch(nextBatch);
        setError('');
      })
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : t('analysisBatch.loadFailed')),
      );
    void streamAudioAnalysisBatch({
      batchId,
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === 'snapshot') setBatch(event.batch);
      },
    }).catch(() => {
      if (controller.signal.aborted) return;
      setRestFallback(true);
      fallbackTimer = setInterval(
        () =>
          void getAudioAnalysisBatch(batchId)
            .then(setBatch)
            .catch(() => undefined),
        15_000,
      );
    });
    return () => {
      controller.abort();
      if (fallbackTimer) clearInterval(fallbackTimer);
    };
  }, [batchId, t]);

  async function command(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await action();
      await refresh();
      Alert.alert(success);
    } catch (reason) {
      Alert.alert(
        t('batchDetail.operationFailed'),
        reason instanceof Error ? reason.message : t('analysisBatch.tryAgain'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.page}>
      <PageHeader
        onBack={() => backOrReplace(router, '/(tabs)/create')}
        onMore={() => undefined}
        title={t('batchDetail.title')}
      />
      {!batch && !error ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.ink} />
        </View>
      ) : null}
      {error && !batch ? (
        <ScrollView
          alwaysBounceVertical
          contentContainerStyle={styles.center}
          refreshControl={<ScreenRefreshControl {...screenRefresh} />}
        >
          <Text style={styles.danger}>{error}</Text>
          <Action label={t('common.retry')} onPress={() => void refresh()} />
        </ScrollView>
      ) : null}
      {batch ? (
        <ScrollView
          alwaysBounceVertical
          contentContainerStyle={styles.content}
          refreshControl={<ScreenRefreshControl {...screenRefresh} />}
        >
          {error ? (
            <Text accessibilityRole="alert" style={styles.danger}>
              {error}
            </Text>
          ) : null}
          <View style={styles.summary}>
            <Text style={styles.title}>
              {t('batchDetail.total', { count: batch.counts.total })}
            </Text>
            <Text style={styles.summaryText}>{t('batchDetail.counts', batch.counts)}</Text>
            <Text style={styles.hint}>
              {batch.scheduledFor
                ? t('batchDetail.scheduled', { date: formatDateTime(batch.scheduledFor) })
                : t('analysisBatch.now')}
            </Text>
            {restFallback ? (
              <Text style={styles.warning}>{t('batchDetail.liveFallback')}</Text>
            ) : null}
          </View>
          <View style={styles.actions}>
            {batch.counts.blocked > 0 ? (
              <Action
                disabled={busy}
                label={t('batchDetail.resumeAll')}
                onPress={() =>
                  void command(
                    () => resumeAudioAnalysisBatch(batch.id),
                    t('batchDetail.resumedBatch'),
                  )
                }
              />
            ) : null}
            {batch.counts.active > 0 || batch.counts.blocked > 0 ? (
              <Action
                danger
                disabled={busy}
                label={t('batchDetail.cancelBatch')}
                onPress={() =>
                  void command(
                    () => cancelAudioAnalysisBatch(batch.id),
                    t('batchDetail.cancelSubmitted'),
                  )
                }
              />
            ) : null}
          </View>
          <View style={styles.snapshot}>
            <Text style={styles.sectionTitle}>{t('batchDetail.snapshot')}</Text>
            <Text style={styles.hint}>{batch.configurationSnapshot.groupName}</Text>
            <Text style={styles.hint}>
              {t('batchDetail.language', {
                language:
                  batch.configurationSnapshot.language === 'zh-CN'
                    ? t('analysisLanguage.zhCN')
                    : t('analysisLanguage.en'),
              })}
            </Text>
            <Text style={styles.body}>{batch.configurationSnapshot.contentFocus}</Text>
            <Text style={styles.hint}>
              {t('batchDetail.resources', {
                knowledge: batch.configurationSnapshot.knowledgeBaseIds.length,
                tags: batch.configurationSnapshot.customTags.join('、') || t('analysisBatch.none'),
              })}
            </Text>
          </View>
          {batch.tasks.map((task) => (
            <TaskCard
              busy={busy}
              groupId={batch.groupId}
              key={task.id}
              onCancel={() =>
                command(() => cancelAudioAnalysisTask(task.id), t('batchDetail.cancelSubmitted'))
              }
              onRemount={() =>
                command(async () => {
                  if (!task.audioFileId) throw new Error(t('batchDetail.taskUnbound'));
                  const selection = await pickDocumentAsync({
                    type: 'audio/*',
                    multiple: false,
                    copyToCacheDirectory: false,
                  });
                  if (!selection || selection.canceled) return;
                  await remountAudioSource(task.audioFileId, selection.assets[0]!);
                }, t('batchDetail.remounted'))
              }
              onResume={() =>
                command(() => resumeAudioAnalysisTask(task.id), t('batchDetail.taskResumed'))
              }
              task={task}
            />
          ))}
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

function TaskCard({
  busy,
  groupId,
  onCancel,
  onRemount,
  onResume,
  task,
}: {
  busy: boolean;
  groupId: string;
  onCancel: () => Promise<void>;
  onRemount: () => Promise<void>;
  onResume: () => Promise<void>;
  task: AudioAnalysisTask;
}) {
  const { formatDateTime, t } = useAppLanguage();
  const router = useRouter();
  const active = ['awaiting_upload', 'scheduled', 'queued', 'running'].includes(task.status);
  const canViewReport =
    (task.status === 'completed' || task.status === 'completed_with_warnings') &&
    task.reportAvailable &&
    Boolean(task.report);
  const phaseText =
    task.status === 'failed'
      ? t('batchDetail.failedBusiness')
      : task.status === 'canceled'
        ? t('batchDetail.status.canceled')
        : t('batchDetail.taskPhase', {
            phase: t(phaseLabelKeys[task.phase]),
            progress: task.progress,
            mode: task.runtimeMode ?? t('batchDetail.status.awaiting_upload'),
          });
  return (
    <View style={styles.card}>
      <View style={styles.cardTitleRow}>
        <Text numberOfLines={1} style={styles.cardTitle}>
          {task.title}
        </Text>
        <Text
          style={[
            styles.badge,
            task.status === 'hard_blocked' && styles.danger,
            task.status === 'completed_with_warnings' && styles.warningBadge,
          ]}
        >
          {t(statusLabelKeys[task.status])}
        </Text>
      </View>
      <Text style={styles.hint}>{phaseText}</Text>
      <View style={styles.progress}>
        <View style={[styles.progressValue, { width: `${task.progress}%` }]} />
      </View>
      {task.warningCodes.length ? (
        <Text style={styles.warning}>
          {t('batchDetail.limits', { codes: task.warningCodes.join('、') })}
        </Text>
      ) : null}
      {task.blocker ? (
        <View accessibilityRole="alert" style={styles.blocker}>
          <Text style={styles.danger}>
            {localizeRequestError(task.blocker.reason, task.blocker.message)}
          </Text>
          {task.blocker.sourceExpiresAt ? (
            <Text style={styles.hint}>
              {t('batchDetail.sourceExpires', {
                date: formatDateTime(task.blocker.sourceExpiresAt),
              })}
            </Text>
          ) : null}
        </View>
      ) : null}
      {task.error ? (
        <Text accessibilityRole="alert" style={styles.danger}>
          {localizeRequestError(task.error.code, task.error.message)}
        </Text>
      ) : null}
      {canViewReport ? (
        <Action
          disabled={busy}
          label={t('batchDetail.viewReport')}
          onPress={() =>
            router.push({
              pathname: '/analysis/[id]',
              params: { id: task.report!.audioFileId, groupId: task.report!.groupId || groupId },
            })
          }
        />
      ) : null}
      <View style={styles.actions}>
        {task.status === 'hard_blocked' && task.blocker?.reason !== 'SOURCE_REMOUNT_REQUIRED' ? (
          <Action disabled={busy} label={t('batchDetail.resume')} onPress={() => void onResume()} />
        ) : null}
        {task.blocker?.reason === 'SOURCE_REMOUNT_REQUIRED' ? (
          <Action
            disabled={busy}
            label={t('batchDetail.remount')}
            onPress={() => void onRemount()}
          />
        ) : null}
        {active || task.status === 'hard_blocked' ? (
          <Action
            danger
            disabled={busy}
            label={t('common.cancel')}
            onPress={() => void onCancel()}
          />
        ) : null}
      </View>
    </View>
  );
}

function Action({
  danger = false,
  disabled = false,
  label,
  onPress,
}: {
  danger?: boolean;
  disabled?: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.action, danger && styles.actionDanger, disabled && styles.disabled]}
    >
      <Text style={[styles.actionText, danger && styles.danger]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { backgroundColor: colors.canvas, flex: 1 },
  center: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.md,
    justifyContent: 'center',
    padding: spacing.md,
  },
  content: { gap: spacing.md, padding: spacing.md, paddingBottom: spacing.xxl },
  summary: {
    backgroundColor: colors.card,
    borderRadius: radii.default,
    gap: spacing.sm,
    padding: spacing.md,
  },
  title: { ...typography.heading1, color: textColors.primary, fontWeight: 'bold' },
  summaryText: { ...typography.body, color: textColors.primary },
  hint: { ...typography.description, color: textColors.secondary },
  body: { ...typography.body, color: textColors.primary },
  warning: { ...typography.description, color: '#9A6500' },
  danger: { ...typography.description, color: colors.danger },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  action: {
    borderColor: colors.ink,
    borderRadius: radii.default,
    borderWidth: 1,
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: spacing.base,
  },
  actionDanger: { borderColor: colors.danger },
  actionText: { ...typography.description, color: textColors.primary, fontWeight: 'bold' },
  disabled: { opacity: 0.5 },
  snapshot: {
    backgroundColor: colors.card,
    borderRadius: radii.default,
    gap: spacing.sm,
    padding: spacing.md,
  },
  sectionTitle: { ...typography.heading2, color: textColors.primary, fontWeight: 'bold' },
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.default,
    gap: spacing.sm,
    padding: spacing.md,
  },
  cardTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  cardTitle: { ...typography.body, color: textColors.primary, flex: 1, fontWeight: 'bold' },
  badge: { ...typography.label, color: colors.success },
  warningBadge: { color: '#9A6500' },
  progress: {
    backgroundColor: colors.divider,
    borderRadius: radii.round,
    height: 6,
    overflow: 'hidden',
  },
  progressValue: { backgroundColor: colors.success, height: 6 },
  blocker: {
    backgroundColor: '#FFF4F2',
    borderRadius: radii.default,
    gap: spacing.xs,
    padding: spacing.sm,
  },
});
