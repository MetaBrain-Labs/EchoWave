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
  SupportedLanguage,
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
import { AnalysisLanguagePicker } from '@/shared/i18n/AnalysisLanguagePicker';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import { localizeRequestError } from '@/shared/i18n/errorLocalization';
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
  const { formatDateTime, t } = useAppLanguage();
  const emotion = type === 'emotion';
  const lightweightBundledEmotion = emotion && runtimeMode === 'lightweight_local';
  const completedDuringTranscription = lightweightBundledEmotion && state.state === 'ready';
  const title = emotion ? t('post.emotionTitle') : t('post.roleTitle');
  const running = state.state === 'queued' || state.state === 'running';
  const remountRequired = state.state === 'failed' && state.requiresSourceRemount === true;
  const unavailable =
    state.state === 'not_requested' || state.state === 'source_unavailable' || remountRequired;
  const versionLabel =
    state.state === 'idle' || unavailable
      ? ''
      : ` · ${t('post.version', { version: state.confirmationVersion })} · ${t(
          'analysisLanguage.current',
          {
            language:
              state.language === 'zh-CN' ? t('analysisLanguage.zhCN') : t('analysisLanguage.en'),
          },
        )}`;
  const action = lightweightBundledEmotion
    ? t('post.doneInTranscription')
    : state.state === 'ready' || state.state === 'failed'
      ? emotion
        ? t('post.rerunEmotion')
        : t('post.rerunRole')
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
              ? t('post.confirmTranscript')
              : state.state === 'idle'
                ? emotion
                  ? t('post.emotionDescription')
                  : t('post.roleDescription')
                : state.state === 'not_requested'
                  ? t('post.notRequested')
                  : state.state === 'source_unavailable'
                    ? t('post.sourceUnavailable')
                    : state.state === 'queued'
                      ? lightweightBundledEmotion
                        ? t('post.autoQueued')
                        : t('post.queued')
                      : state.state === 'running'
                        ? lightweightBundledEmotion
                          ? t('post.autoRunning', { progress: state.progress })
                          : t('post.running', { progress: state.progress })
                        : state.state === 'ready'
                          ? lightweightBundledEmotion
                            ? t('post.bundledReady')
                            : t('post.completed', { date: formatDateTime(state.completedAt) })
                          : state.state === 'failed'
                            ? remountRequired
                              ? t('post.remountSuffix', {
                                  message: localizeRequestError(state.code, state.message),
                                })
                              : localizeRequestError(state.code, state.message)
                            : t('post.queued')}
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
  const { t } = useAppLanguage();
  const [collapsed, setCollapsed] = useState(getPostAnalysisControlsCollapsedPreference);
  const toggleCollapsed = () => {
    const nextCollapsed = !collapsed;
    setCollapsed(nextCollapsed);
    setPostAnalysisControlsCollapsedPreference(nextCollapsed);
  };

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityLabel={collapsed ? t('post.expand') : t('post.collapse')}
        accessibilityRole="button"
        accessibilityState={{ expanded: !collapsed }}
        onPress={toggleCollapsed}
        style={({ pressed }) => [styles.collapseHeader, pressed && styles.pressed]}
      >
        <Ionicons color={colors.secondary} name="analytics-outline" size={22} />
        <View style={styles.collapseCopy}>
          <Text style={styles.collapseTitle}>{t('post.sectionTitle')}</Text>
          <Text style={styles.collapseDescription}>
            {collapsed
              ? t('post.collapsedDescription')
              : runtimeMode === 'lightweight_local'
                ? t('post.lightweightDescription')
                : t('post.expandedDescription')}
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
              accessibilityLabel={t('post.remount')}
              accessibilityRole="button"
              onPress={onRemountSource}
              style={styles.remountAction}
            >
              <Text style={styles.actionText}>{t('post.remount')}</Text>
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
  language,
  onLanguageChange,
}: {
  pending: boolean;
  type?: AudioPostAnalysisType;
  onCancel: () => void;
  onConfirm: () => void;
  language: SupportedLanguage;
  onLanguageChange: (language: SupportedLanguage) => void;
}) {
  const { t } = useAppLanguage();
  const emotion = type === 'emotion';
  return (
    <Modal animationType="fade" onRequestClose={onCancel} transparent visible={Boolean(type)}>
      <View style={styles.dialogRoot}>
        <View accessibilityViewIsModal style={styles.dialogCard}>
          <Text accessibilityRole="header" style={styles.dialogTitle}>
            {emotion ? t('post.startEmotionTitle') : t('post.startRoleTitle')}
          </Text>
          <Text style={styles.dialogBody}>
            {emotion ? t('post.emotionCost') : t('post.roleCost')} {t('post.preserveResult')}
          </Text>
          <AnalysisLanguagePicker value={language} onChange={onLanguageChange} />
          <View style={styles.dialogActions}>
            <Pressable disabled={pending} onPress={onCancel} style={styles.dialogButton}>
              <Text style={styles.cancelText}>{t('common.cancel')}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={pending}
              onPress={onConfirm}
              style={[styles.dialogButton, styles.confirmButton]}
            >
              <Text style={styles.confirmText}>
                {pending ? t('post.starting') : t('common.confirm')}
              </Text>
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
