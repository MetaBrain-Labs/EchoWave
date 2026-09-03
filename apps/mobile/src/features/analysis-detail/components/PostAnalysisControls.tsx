/**
 * ASR 后置分析任务控件。
 *
 * 展示情绪分析与角色识别的独立状态、进度、失败和重跑入口，并提供模型费用确认弹窗。
 *
 * Responsibilities:
 * - 将共享任务状态转换为中文可访问文案。
 * - 保持确认与网络执行由页面编排器控制。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type {
  AudioPostAnalysisState,
  AudioPostAnalysisType,
  AudioRuntimeMode,
} from '@echowave/contracts';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';
import {
  getPostAnalysisControlsCollapsedPreference,
  setPostAnalysisControlsCollapsedPreference,
} from '../preferences';

function TaskCard({
  confirmed,
  type,
  state,
  runtimeMode,
  onStart,
  onRemountSource,
}: {
  confirmed: boolean;
  type: AudioPostAnalysisType;
  state: AudioPostAnalysisState;
  runtimeMode: AudioRuntimeMode;
  onStart: (type: AudioPostAnalysisType) => void;
  onRemountSource?: () => void;
}) {
  const emotion = type === 'emotion';
  const lightweightBundledEmotion = emotion && runtimeMode === 'lightweight_local';
  const completedDuringTranscription = lightweightBundledEmotion && state.state === 'ready';
  const title = emotion ? '情绪分析' : '角色识别';
  const running = state.state === 'queued' || state.state === 'running';
  const remountRequired = state.state === 'failed' && state.requiresSourceRemount === true;
  const unavailable =
    state.state === 'not_requested' || state.state === 'source_unavailable' || remountRequired;
  const versionLabel =
    state.state === 'idle' || unavailable ? '' : ` · 基于确认版 v${state.confirmationVersion}`;
  const action = lightweightBundledEmotion
    ? '已在转写时完成'
    : state.state === 'ready' || state.state === 'failed'
      ? emotion
        ? '重新分析'
        : '重新识别'
      : title;
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Ionicons
          color={colors.secondary}
          name={emotion ? 'happy-outline' : 'people-outline'}
          size={22}
        />
        <View style={styles.cardCopy}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.meta}>
            {!confirmed
              ? '请先确认转写正文'
              : state.state === 'idle'
                ? emotion
                  ? '使用 Qwen3.5-Omni 分析每个说话轮次'
                  : '使用 DeepSeek 识别录音级业务角色'
                : state.state === 'not_requested'
                  ? '本次转写未启用声学情绪分析；需重新选择源文件并新建转写'
                  : state.state === 'source_unavailable'
                    ? '源音频已清理或过期，无法再次执行声学分析'
                    : state.state === 'queued'
                      ? lightweightBundledEmotion
                        ? '随本次转写自动执行'
                        : '等待后台任务'
                      : state.state === 'running'
                        ? lightweightBundledEmotion
                          ? `随本次转写自动执行 · 分析中 ${state.progress}%`
                          : `分析中 ${state.progress}%`
                        : state.state === 'ready'
                          ? lightweightBundledEmotion
                            ? '已在转写时完成声学情绪分析'
                            : `已完成 · ${new Date(state.completedAt).toLocaleString()}`
                          : state.state === 'failed'
                            ? remountRequired
                              ? `${state.message} 请重新选择原音频并创建新转写。`
                              : state.message
                            : '等待后台任务'}
            {confirmed ? versionLabel : ''}
          </Text>
        </View>
      </View>
      {running ? (
        <View style={styles.runningRow}>
          <ActivityIndicator color={colors.ink} />
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${state.progress}%` }]} />
          </View>
        </View>
      ) : unavailable || completedDuringTranscription || lightweightBundledEmotion ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !confirmed }}
          disabled={!confirmed}
          onPress={() => onStart(type)}
          style={({ pressed }) => [
            styles.action,
            !confirmed && styles.disabledAction,
            pressed && confirmed && styles.pressed,
          ]}
        >
          <Text style={styles.actionText}>{action}</Text>
        </Pressable>
      )}
    </View>
  );
}

/** 渲染两个可独立运行的后置分析任务。 */
export function PostAnalysisControls({
  confirmed,
  emotion,
  role,
  runtimeMode = 'hybrid',
  onStart,
  onRemountSource,
}: {
  confirmed: boolean;
  emotion: AudioPostAnalysisState;
  role: AudioPostAnalysisState;
  runtimeMode?: AudioRuntimeMode;
  onStart: (type: AudioPostAnalysisType) => void;
  onRemountSource?: () => void;
}) {
  const [collapsed, setCollapsed] = useState(getPostAnalysisControlsCollapsedPreference);
  const toggleCollapsed = () => {
    const nextCollapsed = !collapsed;
    setCollapsed(nextCollapsed);
    setPostAnalysisControlsCollapsedPreference(nextCollapsed);
  };

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityLabel={collapsed ? '展开情绪分析与角色识别' : '折叠情绪分析与角色识别'}
        accessibilityRole="button"
        accessibilityState={{ expanded: !collapsed }}
        onPress={toggleCollapsed}
        style={({ pressed }) => [styles.collapseHeader, pressed && styles.pressed]}
      >
        <Ionicons color={colors.secondary} name="analytics-outline" size={22} />
        <View style={styles.collapseCopy}>
          <Text style={styles.collapseTitle}>情绪分析与角色识别</Text>
          <Text style={styles.collapseDescription}>
            {collapsed
              ? '点击展开分析状态与操作'
              : runtimeMode === 'lightweight_local'
                ? '声学情绪随本次转写自动执行，角色识别可单独运行'
                : '可分别查看状态或重新运行分析'}
          </Text>
        </View>
        <Ionicons
          color={colors.secondary}
          name={collapsed ? 'chevron-down' : 'chevron-up'}
          size={20}
        />
      </Pressable>
      {!collapsed ? (
        <View style={styles.cards}>
          <TaskCard
            confirmed={confirmed}
            onStart={onStart}
            runtimeMode={runtimeMode}
            state={emotion}
            type="emotion"
          />
          {(emotion.state === 'not_requested' ||
            (emotion.state === 'source_unavailable' && emotion.reason !== 'source_expired') ||
            (emotion.state === 'failed' && emotion.requiresSourceRemount === true)) &&
          onRemountSource ? (
            <Pressable
              accessibilityLabel="重新选择源音频并创建新转写"
              accessibilityRole="button"
              onPress={onRemountSource}
              style={styles.remountAction}
            >
              <Text style={styles.actionText}>重新选择源音频并创建新转写</Text>
            </Pressable>
          ) : null}
          <TaskCard
            confirmed={confirmed}
            onStart={onStart}
            runtimeMode={runtimeMode}
            state={role}
            type="role"
          />
        </View>
      ) : null}
    </View>
  );
}

/** 在产生模型调用费用前确认任务范围。 */
export function PostAnalysisConfirmDialog({
  pending,
  type,
  onCancel,
  onConfirm,
}: {
  pending: boolean;
  type?: AudioPostAnalysisType;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const emotion = type === 'emotion';
  return (
    <Modal animationType="fade" onRequestClose={onCancel} transparent visible={Boolean(type)}>
      <View style={styles.dialogRoot}>
        <View accessibilityViewIsModal style={styles.dialogCard}>
          <Text accessibilityRole="header" style={styles.dialogTitle}>
            {emotion ? '开始情绪分析？' : '开始角色识别？'}
          </Text>
          <Text style={styles.dialogBody}>
            {emotion
              ? '将使用 Qwen3.5-Omni-Flash 分析所有转写片段的声学情绪，并产生模型调用费用。'
              : '将使用 DeepSeek 根据完整正文和说话人识别业务角色，并产生模型调用费用。'}
            已发布结果会保留到本次任务成功。
          </Text>
          <View style={styles.dialogActions}>
            <Pressable disabled={pending} onPress={onCancel} style={styles.dialogButton}>
              <Text style={styles.cancelText}>取消</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={pending}
              onPress={onConfirm}
              style={[styles.dialogButton, styles.confirmButton]}
            >
              <Text style={styles.confirmText}>{pending ? '正在启动…' : '确认'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  collapseHeader: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radii.default,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 56,
    padding: spacing.base,
  },
  collapseCopy: { flex: 1 },
  collapseTitle: {
    ...typography.heading3,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
  },
  collapseDescription: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  cards: { gap: spacing.sm, marginTop: spacing.sm },
  card: { backgroundColor: colors.background, borderRadius: radii.default, padding: spacing.base },
  cardHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  cardCopy: { flex: 1 },
  title: { ...typography.heading3, color: textColors.primary, fontFamily: fontFamilies.sansBold },
  meta: { ...typography.description, color: textColors.secondary, fontFamily: fontFamilies.sans },
  runningRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  track: { backgroundColor: colors.divider, borderRadius: radii.round, flex: 1, height: 4 },
  fill: { backgroundColor: colors.ink, borderRadius: radii.round, height: 4 },
  action: {
    alignSelf: 'flex-end',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  actionText: {
    ...typography.heading5,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
  },
  remountAction: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    minHeight: 44,
    justifyContent: 'center',
  },
  disabledAction: { opacity: 0.45 },
  pressed: { opacity: 0.65 },
  dialogRoot: {
    alignItems: 'center',
    backgroundColor: 'rgba(16, 24, 40, 0.28)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.md,
  },
  dialogCard: {
    backgroundColor: colors.white,
    borderRadius: radii.default,
    gap: spacing.md,
    padding: spacing.md,
    width: '100%',
  },
  dialogTitle: {
    ...typography.heading2,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
  },
  dialogBody: { ...typography.body, color: textColors.secondary, fontFamily: fontFamilies.sans },
  dialogActions: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'flex-end' },
  dialogButton: {
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    minWidth: 88,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.base,
  },
  confirmButton: { backgroundColor: colors.black, borderColor: colors.black },
  cancelText: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    textAlign: 'center',
  },
  confirmText: {
    ...typography.body,
    color: colors.white,
    fontFamily: fontFamilies.sansBold,
    textAlign: 'center',
  },
});
