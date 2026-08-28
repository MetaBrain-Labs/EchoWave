/**
 * 销售复盘任务状态与分析前检查。
 *
 * 展示当前分组业务分析的进度、失败和重跑入口，并在启动前明确告知角色与情绪识别
 * 是否可用于当前确认版本。
 *
 * Responsibilities:
 * - 呈现业务分析任务状态和操作按钮。
 * - 提供不可绕过的分析前识别状态弹窗。
 *
 * Notes:
 * - 网络请求和弹窗状态由 AnalysisDetailScreen 编排。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type { AudioBusinessAnalysisState, AudioPostAnalysisState } from '@echowave/contracts';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';

function enrichmentLabel(state: AudioPostAnalysisState, currentVersion: number): string {
  if (state.state === 'idle') return '未识别';
  if (state.confirmationVersion !== currentVersion)
    return `已过期（基于 v${state.confirmationVersion}）`;
  if (state.state === 'queued') return '等待中';
  if (state.state === 'running') return `识别中 ${state.progress}%`;
  if (state.state === 'failed') return '识别失败';
  return '已完成';
}

function stateLabel(state: AudioBusinessAnalysisState): string {
  if (state.state === 'idle') return '尚未分析';
  if (state.state === 'queued') {
    return state.result ? '等待重新分析，当前仍展示上一版本' : '等待分析';
  }
  if (state.state === 'running') {
    return state.result
      ? `正在重新分析 ${state.progress}%，当前仍展示上一版本`
      : `正在分析 ${state.progress}%`;
  }
  if (state.state === 'failed') return state.result ? '重新分析失败，仍展示上一版本' : '分析失败';
  return state.settingsCurrent && state.knowledgeCurrent
    ? '分析完成'
    : '已有结果，设置或关联已更新';
}

/** 展示当前分组业务分析状态与启动或重跑入口。 */
export function BusinessAnalysisControls({
  onStart,
  state,
}: {
  onStart: (force: boolean) => void;
  state: AudioBusinessAnalysisState;
}) {
  const processing = state.state === 'queued' || state.state === 'running';
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.iconSurface}>
          <Ionicons color={colors.success} name="analytics-outline" size={22} />
        </View>
        <View style={styles.cardCopy}>
          <Text style={styles.cardTitle}>ASR 结果分析</Text>
          <Text style={styles.cardDescription}>{stateLabel(state)}</Text>
        </View>
        {processing ? <ActivityIndicator color={colors.ink} /> : null}
      </View>
      {state.error ? (
        <Text accessibilityRole="alert" style={styles.errorText}>
          {state.error.message}
        </Text>
      ) : null}
      {!processing ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => onStart(Boolean(state.result))}
          style={styles.action}
        >
          <Text style={styles.actionText}>{state.result ? '重新分析' : '开始分析'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** 在业务分析启动前展示当前确认版本的情绪与角色识别状态。 */
export function BusinessAnalysisPreflightDialog({
  confirmationVersion,
  emotion,
  onCancel,
  onContinue,
  onSupplement,
  pending,
  role,
  visible,
}: {
  confirmationVersion: number;
  emotion: AudioPostAnalysisState;
  onCancel: () => void;
  onContinue: () => void;
  onSupplement: () => void;
  pending: boolean;
  role: AudioPostAnalysisState;
  visible: boolean;
}) {
  const emotionReady =
    emotion.state === 'ready' && emotion.confirmationVersion === confirmationVersion;
  const roleReady = role.state === 'ready' && role.confirmationVersion === confirmationVersion;
  return (
    <Modal animationType="fade" onRequestClose={onCancel} transparent visible={visible}>
      <View style={styles.modalRoot}>
        <Pressable accessibilityLabel="关闭分析前检查" onPress={onCancel} style={styles.backdrop} />
        <View accessibilityRole="alert" style={styles.dialog}>
          <Text style={styles.dialogTitle}>分析前检查</Text>
          <Text style={styles.dialogDescription}>
            未完成情绪识别或角色识别仍可继续，但可能降低销售话术分析质量。
          </Text>
          <View style={styles.checkRow}>
            <Text style={styles.checkTitle}>情绪识别</Text>
            <Text style={[styles.checkState, emotionReady && styles.ready]}>
              {enrichmentLabel(emotion, confirmationVersion)}
            </Text>
          </View>
          <View style={styles.checkRow}>
            <Text style={styles.checkTitle}>角色识别</Text>
            <Text style={[styles.checkState, roleReady && styles.ready]}>
              {enrichmentLabel(role, confirmationVersion)}
            </Text>
          </View>
          <View style={styles.dialogActions}>
            <Pressable disabled={pending} onPress={onCancel} style={styles.dialogButton}>
              <Text style={styles.cancelText}>取消</Text>
            </Pressable>
            {!emotionReady || !roleReady ? (
              <Pressable disabled={pending} onPress={onSupplement} style={styles.dialogButton}>
                <Text style={styles.supplementText}>去补充识别</Text>
              </Pressable>
            ) : null}
            <Pressable
              disabled={pending}
              onPress={onContinue}
              style={[styles.dialogButton, styles.continueButton]}
            >
              <Text style={styles.continueText}>{pending ? '正在启动…' : '仍然分析'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderBottomColor: colors.divider,
    borderBottomWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
  },
  cardHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  iconSurface: {
    alignItems: 'center',
    backgroundColor: colors.successSurface,
    borderRadius: radii.round,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  cardCopy: { flex: 1 },
  cardTitle: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  cardDescription: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    marginTop: spacing.xs,
  },
  action: {
    alignItems: 'center',
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    marginTop: spacing.sm,
    minHeight: 40,
    justifyContent: 'center',
  },
  actionText: {
    ...typography.description,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  errorText: {
    ...typography.description,
    color: colors.danger,
    fontFamily: fontFamilies.sans,
    marginTop: spacing.sm,
  },
  modalRoot: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: spacing.md },
  backdrop: {
    backgroundColor: 'rgba(16, 24, 40, 0.34)',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  dialog: {
    backgroundColor: colors.card,
    borderRadius: radii.default,
    maxWidth: 420,
    padding: spacing.lg,
    width: '100%',
  },
  dialogTitle: {
    ...typography.heading2,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  dialogDescription: {
    ...typography.body,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    marginTop: spacing.sm,
  },
  checkRow: {
    alignItems: 'center',
    borderBottomColor: colors.divider,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 48,
  },
  checkTitle: { ...typography.body, color: textColors.primary, fontFamily: fontFamilies.sans },
  checkState: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sansBold,
  },
  ready: { color: colors.success },
  dialogActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'flex-end',
    marginTop: spacing.lg,
  },
  dialogButton: {
    alignItems: 'center',
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: spacing.md,
  },
  continueButton: { backgroundColor: colors.ink, borderColor: colors.ink },
  cancelText: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sansBold,
  },
  supplementText: {
    ...typography.description,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
  },
  continueText: {
    ...typography.description,
    color: colors.white,
    fontFamily: fontFamilies.sansBold,
  },
});
