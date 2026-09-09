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
import type {
  AudioBusinessAnalysisState,
  AudioPostAnalysisState,
  SupportedLanguage,
} from '@echowave/contracts';
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
import type { TranslationKey } from '@/shared/i18n/translations';

type Translator = (key: TranslationKey, options?: Record<string, unknown>) => string;

function enrichmentLabel(
  state: AudioPostAnalysisState,
  currentVersion: number,
  t: Translator,
): string {
  if (state.state === 'idle') return t('business.notRecognized');
  if (state.state === 'not_requested') return t('business.notEnabled');
  if (state.state === 'source_unavailable') return t('business.sourceUnavailable');
  if (state.confirmationVersion !== currentVersion)
    return t('business.expired', { version: state.confirmationVersion });
  if (state.state === 'queued') return t('business.waiting');
  if (state.state === 'running') return t('business.recognizing', { progress: state.progress });
  if (state.state === 'failed') return t('business.recognitionFailed');
  return t('business.recognitionReady');
}

function stateLabel(state: AudioBusinessAnalysisState, t: Translator): string {
  if (state.state === 'idle') return t('business.idle');
  if (state.state === 'queued') {
    return state.result ? t('business.queuedWithResult') : t('business.queued');
  }
  if (state.state === 'running') {
    return state.result
      ? t('business.runningWithResult', { progress: state.progress })
      : t('business.running', { progress: state.progress });
  }
  if (state.state === 'failed')
    return state.result ? t('business.failedWithResult') : t('business.failed');
  return state.settingsCurrent && state.knowledgeCurrent
    ? t('business.ready')
    : t('business.stale');
}

function errorLabel(state: AudioBusinessAnalysisState, t: Translator): string {
  if (!state.error) return '';
  const prefix =
    state.error.reason === 'timeout'
      ? t('business.timeout')
      : state.error.reason === 'output_truncated'
        ? t('business.truncated')
        : state.error.reason === 'invalid_citation'
          ? t('business.citationFixed')
          : '';
  const message = localizeRequestError(state.error.code, state.error.message);
  return prefix ? `${prefix}: ${message}` : message;
}

/** 展示当前分组业务分析状态与启动或重跑入口。 */
export function BusinessAnalysisControls({
  onStart,
  state,
}: {
  onStart: (force: boolean) => void;
  state: AudioBusinessAnalysisState;
}) {
  const { t } = useAppLanguage();
  const processing = state.state === 'queued' || state.state === 'running';
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.iconSurface}>
          <Ionicons color={colors.secondary} name="stats-chart-outline" size={22} />
        </View>
        <View style={styles.cardCopy}>
          <Text style={styles.cardTitle}>{t('business.cardTitle')}</Text>
          <Text style={styles.cardDescription}>{stateLabel(state, t)}</Text>
          {state.state !== 'idle' ? (
            <Text style={styles.cardDescription}>
              {t('analysisLanguage.current', {
                language:
                  state.language === 'zh-CN'
                    ? t('analysisLanguage.zhCN')
                    : t('analysisLanguage.en'),
              })}
            </Text>
          ) : null}
        </View>
        {processing ? <ActivityIndicator color={colors.ink} /> : null}
      </View>
      {state.error ? (
        <Text accessibilityRole="alert" style={styles.errorText}>
          {errorLabel(state, t)}
        </Text>
      ) : null}
      {!processing ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => onStart(Boolean(state.result))}
          style={styles.action}
        >
          <Text style={styles.actionText}>
            {state.result ? t('business.rerun') : t('business.start')}
          </Text>
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
  language,
  onLanguageChange,
}: {
  confirmationVersion: number;
  emotion: AudioPostAnalysisState;
  onCancel: () => void;
  onContinue: () => void;
  onSupplement: () => void;
  pending: boolean;
  role: AudioPostAnalysisState;
  visible: boolean;
  language: SupportedLanguage;
  onLanguageChange: (language: SupportedLanguage) => void;
}) {
  const { t } = useAppLanguage();
  const emotionReady =
    emotion.state === 'ready' && emotion.confirmationVersion === confirmationVersion;
  const roleReady = role.state === 'ready' && role.confirmationVersion === confirmationVersion;
  return (
    <Modal animationType="fade" onRequestClose={onCancel} transparent visible={visible}>
      <View style={styles.modalRoot}>
        <Pressable
          accessibilityLabel={t('business.closePreflight')}
          onPress={onCancel}
          style={styles.backdrop}
        />
        <View accessibilityRole="alert" style={styles.dialog}>
          <Text style={styles.dialogTitle}>{t('business.preflightTitle')}</Text>
          <Text style={styles.dialogDescription}>{t('business.preflightDescription')}</Text>
          <AnalysisLanguagePicker value={language} onChange={onLanguageChange} />
          <View style={styles.checkRow}>
            <Text style={styles.checkTitle}>{t('business.emotion')}</Text>
            <Text style={[styles.checkState, emotionReady && styles.ready]}>
              {enrichmentLabel(emotion, confirmationVersion, t)}
            </Text>
          </View>
          <View style={styles.checkRow}>
            <Text style={styles.checkTitle}>{t('business.role')}</Text>
            <Text style={[styles.checkState, roleReady && styles.ready]}>
              {enrichmentLabel(role, confirmationVersion, t)}
            </Text>
          </View>
          <View style={styles.dialogActions}>
            <Pressable disabled={pending} onPress={onCancel} style={styles.dialogButton}>
              <Text style={styles.cancelText}>{t('common.cancel')}</Text>
            </Pressable>
            {!emotionReady || !roleReady ? (
              <Pressable disabled={pending} onPress={onSupplement} style={styles.dialogButton}>
                <Text style={styles.supplementText}>{t('business.supplement')}</Text>
              </Pressable>
            ) : null}
            <Pressable
              disabled={pending}
              onPress={onContinue}
              style={[styles.dialogButton, styles.continueButton]}
            >
              <Text style={styles.continueText}>
                {pending ? t('post.starting') : t('business.continue')}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.background,
    borderBottomColor: colors.divider,
    borderBottomWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
  },
  cardHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  iconSurface: {
    alignItems: 'center',
    backgroundColor: colors.background,
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
