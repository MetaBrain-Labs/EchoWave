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
import * as DocumentPicker from 'expo-document-picker';
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
import { streamAudioAnalysisBatch } from '@/shared/api/liveUpdateStreams';
import { backOrReplace } from '@/shared/navigation/routeBack';
import { colors, radii, spacing, textColors, typography } from '@/shared/theme/tokens';
import { PageHeader } from '@/shared/ui/PageHeader';

const statusLabels: Record<AudioAnalysisTask['status'], string> = {
  awaiting_upload: '等待上传',
  scheduled: '等待计划时间',
  queued: '已入队',
  running: '执行中',
  hard_blocked: '需要处理',
  completed: '已完成',
  completed_with_warnings: '完成（有限制）',
  failed: '失败',
  canceled: '已取消',
};

const phaseLabels: Record<AudioAnalysisTask['phase'], string> = {
  upload: '上传校验',
  transcription: 'ASR 转写',
  post_analysis: '情绪与角色',
  business_analysis: '业务分析',
  done: '结束',
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
  const [batch, setBatch] = useState<AudioAnalysisBatch>();
  const [error, setError] = useState('');
  const [restFallback, setRestFallback] = useState(false);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setBatch(await getAudioAnalysisBatch(batchId));
    setError('');
  }

  useEffect(() => {
    const controller = new AbortController();
    let fallbackTimer: ReturnType<typeof setInterval> | undefined;
    void getAudioAnalysisBatch(batchId)
      .then((nextBatch) => {
        setBatch(nextBatch);
        setError('');
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : '加载失败。'));
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
  }, [batchId]);

  async function command(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await action();
      await refresh();
      Alert.alert(success);
    } catch (reason) {
      Alert.alert('操作失败', reason instanceof Error ? reason.message : '请稍后重试。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.page}>
      <PageHeader
        onBack={() => backOrReplace(router, '/(tabs)/create')}
        onMore={() => undefined}
        title="分析批次"
      />
      {!batch && !error ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.ink} />
        </View>
      ) : null}
      {error ? (
        <View accessibilityRole="alert" style={styles.center}>
          <Text style={styles.danger}>{error}</Text>
          <Action label="重试" onPress={() => void refresh()} />
        </View>
      ) : null}
      {batch ? (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.summary}>
            <Text style={styles.title}>共 {batch.counts.total} 项</Text>
            <Text style={styles.summaryText}>
              进行中 {batch.counts.active} · 阻塞 {batch.counts.blocked} · 完成{' '}
              {batch.counts.completed} · 有限制 {batch.counts.partial} · 失败 {batch.counts.failed}{' '}
              · 已取消 {batch.counts.canceled}
            </Text>
            <Text style={styles.hint}>
              {batch.scheduledFor
                ? `计划时间：${new Date(batch.scheduledFor).toLocaleString()}`
                : '立即执行'}
            </Text>
            {restFallback ? (
              <Text style={styles.warning}>实时连接已断开，当前每 15 秒刷新一次。</Text>
            ) : null}
          </View>
          <View style={styles.actions}>
            {batch.counts.blocked > 0 ? (
              <Action
                disabled={busy}
                label="恢复全部阻塞项"
                onPress={() => void command(() => resumeAudioAnalysisBatch(batch.id), '已恢复批次')}
              />
            ) : null}
            {batch.counts.active > 0 || batch.counts.blocked > 0 ? (
              <Action
                danger
                disabled={busy}
                label="取消批次"
                onPress={() => void command(() => cancelAudioAnalysisBatch(batch.id), '已提交取消')}
              />
            ) : null}
          </View>
          <View style={styles.snapshot}>
            <Text style={styles.sectionTitle}>冻结配置</Text>
            <Text style={styles.hint}>{batch.configurationSnapshot.groupName}</Text>
            <Text style={styles.body}>{batch.configurationSnapshot.contentFocus}</Text>
            <Text style={styles.hint}>
              知识库 {batch.configurationSnapshot.knowledgeBaseIds.length} 个 · 标签{' '}
              {batch.configurationSnapshot.customTags.join('、') || '无'}
            </Text>
          </View>
          {batch.tasks.map((task) => (
            <TaskCard
              busy={busy}
              groupId={batch.groupId}
              key={task.id}
              onCancel={() => command(() => cancelAudioAnalysisTask(task.id), '已提交取消')}
              onRemount={() =>
                command(async () => {
                  if (!task.audioFileId) throw new Error('任务尚未绑定音频。');
                  const selection = await DocumentPicker.getDocumentAsync({
                    type: 'audio/*',
                    multiple: false,
                    copyToCacheDirectory: false,
                  });
                  if (selection.canceled) return;
                  await remountAudioSource(task.audioFileId, selection.assets[0]!);
                }, '源文件已重新挂载，任务将从中断点继续')
              }
              onResume={() => command(() => resumeAudioAnalysisTask(task.id), '已恢复任务')}
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
  const router = useRouter();
  const active = ['awaiting_upload', 'scheduled', 'queued', 'running'].includes(task.status);
  const canViewReport =
    (task.status === 'completed' || task.status === 'completed_with_warnings') &&
    task.reportAvailable &&
    Boolean(task.report);
  const phaseText =
    task.status === 'failed'
      ? '失败于业务分析'
      : task.status === 'canceled'
        ? '已取消'
        : `${phaseLabels[task.phase]} · ${task.progress}% · ${task.runtimeMode ?? '等待上传'}`;
  return (
    <View style={styles.card}>
      <View style={styles.cardTitleRow}>
        <Text numberOfLines={1} style={styles.cardTitle}>
          {task.title}
        </Text>
        <Text style={[styles.badge, task.status === 'hard_blocked' && styles.danger]}>
          {statusLabels[task.status]}
        </Text>
      </View>
      <Text style={styles.hint}>{phaseText}</Text>
      <View style={styles.progress}>
        <View style={[styles.progressValue, { width: `${task.progress}%` }]} />
      </View>
      {task.warningCodes.length ? (
        <Text style={styles.warning}>限制：{task.warningCodes.join('、')}</Text>
      ) : null}
      {task.blocker ? (
        <View accessibilityRole="alert" style={styles.blocker}>
          <Text style={styles.danger}>{task.blocker.message}</Text>
          {task.blocker.sourceExpiresAt ? (
            <Text style={styles.hint}>
              源文件保留至 {new Date(task.blocker.sourceExpiresAt).toLocaleString()}
              ；过期后需重新选择同一文件。
            </Text>
          ) : null}
        </View>
      ) : null}
      {task.error ? (
        <Text accessibilityRole="alert" style={styles.danger}>
          {task.error.message}
        </Text>
      ) : null}
      {canViewReport ? (
        <Action
          disabled={busy}
          label="查看分析报告"
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
          <Action disabled={busy} label="从中断点继续" onPress={() => void onResume()} />
        ) : null}
        {task.blocker?.reason === 'SOURCE_REMOUNT_REQUIRED' ? (
          <Action disabled={busy} label="重新选择原文件" onPress={() => void onRemount()} />
        ) : null}
        {active || task.status === 'hard_blocked' ? (
          <Action danger disabled={busy} label="取消" onPress={() => void onCancel()} />
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
