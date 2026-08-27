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
import type { AudioPostAnalysisState, AudioPostAnalysisType } from '@echowave/contracts';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';

function TaskCard({
  type,
  state,
  onStart,
}: {
  type: AudioPostAnalysisType;
  state: AudioPostAnalysisState;
  onStart: (type: AudioPostAnalysisType) => void;
}) {
  const emotion = type === 'emotion';
  const title = emotion ? '情绪分析' : '角色识别';
  const running = state.state === 'queued' || state.state === 'running';
  const action =
    state.state === 'ready' || state.state === 'failed'
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
            {state.state === 'idle'
              ? emotion
                ? '使用 Qwen3.5-Omni 分析每个说话轮次'
                : '使用 DeepSeek 识别录音级业务角色'
              : state.state === 'queued'
                ? '等待后台任务'
                : state.state === 'running'
                  ? `分析中 ${state.progress}%`
                  : state.state === 'ready'
                    ? `已完成 · ${new Date(state.completedAt).toLocaleString()}`
                    : state.state === 'failed'
                      ? state.message
                      : '等待后台任务'}
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
      ) : (
        <Pressable
          accessibilityRole="button"
          onPress={() => onStart(type)}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          <Text style={styles.actionText}>{action}</Text>
        </Pressable>
      )}
    </View>
  );
}

/** 渲染两个可独立运行的后置分析任务。 */
export function PostAnalysisControls({
  emotion,
  role,
  onStart,
}: {
  emotion: AudioPostAnalysisState;
  role: AudioPostAnalysisState;
  onStart: (type: AudioPostAnalysisType) => void;
}) {
  return (
    <View style={styles.container}>
      <TaskCard onStart={onStart} state={emotion} type="emotion" />
      <TaskCard onStart={onStart} state={role} type="role" />
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
  container: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.md },
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
