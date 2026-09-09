/**
 * 推送通知登记状态卡片。
 *
 * 展示当前设备从系统权限到 EchoWave Server 登记的实际阶段，并提供不泄露 Token 的
 * 手动重试入口。
 *
 * Responsibilities:
 * - 显示推送登记状态、脱敏错误代码和最近尝试时间。
 * - 触发应用级推送登记重试。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { forwardRef, useImperativeHandle } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  usePushNotificationRegistration,
  type PushRegistrationState,
} from '@/shared/notifications/PushNotificationProvider';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';

/** 推送状态卡暴露给下拉刷新的句柄。 */
export type PushNotificationStatusCardHandle = {
  refresh: () => Promise<void>;
};

/** 渲染当前设备的远程推送登记状态和重试操作。 */
export const PushNotificationStatusCard = forwardRef<PushNotificationStatusCardHandle>(
  function PushNotificationStatusCard(_props, ref) {
    const { formatDateTime, t } = useAppLanguage();
    const { state, refresh } = usePushNotificationRegistration();
    useImperativeHandle(ref, () => ({ refresh }), [refresh]);
    const loading = ['checking', 'fetching_token', 'registering'].includes(state.phase);
    const registered = state.phase === 'registered';
    const label = statusLabel(state, t);

    return (
      <View style={styles.card} testID="push-notification-status-card">
        <View style={styles.headingRow}>
          <View>
            <Text style={styles.eyebrow}>REMOTE PUSH</Text>
            <Text style={styles.title}>{t('pushCard.title')}</Text>
          </View>
          <View
            accessibilityLabel={label}
            style={[styles.statusBadge, registered ? styles.onlineBadge : styles.neutralBadge]}
          >
            {loading ? (
              <ActivityIndicator color={colors.secondary} size={typography.label.lineHeight} />
            ) : (
              <Ionicons
                color={registered ? colors.success : colors.secondary}
                name={registered ? 'notifications' : 'notifications-off-outline'}
                size={typography.label.lineHeight}
              />
            )}
            <Text style={[styles.statusLabel, registered && styles.onlineStatusLabel]}>
              {label}
            </Text>
          </View>
        </View>

        <View style={styles.messageBox}>
          <StatusLine
            label={t('pushCard.serverCapability')}
            value={serverCapabilityLabel(state, t)}
          />
          <StatusLine
            label={t('pushCard.systemPermission')}
            value={systemPermissionLabel(state, t)}
          />
          <StatusLine
            label={t('pushCard.deviceRegistration')}
            value={deviceRegistrationLabel(state, t)}
          />
          <Text style={styles.message}>{state.message}</Text>
          {state.errorCode ? (
            <Text style={styles.diagnostic}>{t('pushCard.code', { code: state.errorCode })}</Text>
          ) : null}
          {state.lastAttemptAt ? (
            <Text style={styles.diagnostic}>
              {t('pushCard.lastAttempt', { date: formatDateTime(state.lastAttemptAt) })}
            </Text>
          ) : null}
        </View>

        <View style={styles.permissionNotice}>
          <Text style={styles.permissionTitle}>{t('pushCard.permissionTitle')}</Text>
          <Text style={styles.permissionText}>{t('pushCard.permissionDescription')}</Text>
          <Text style={styles.permissionText}>{t('pushCard.androidDescription')}</Text>
        </View>

        <Pressable
          accessibilityLabel={t('pushCard.reregister')}
          accessibilityRole="button"
          disabled={loading}
          onPress={() => void refresh()}
          style={({ pressed }) => [
            styles.retryButton,
            loading && styles.disabledButton,
            pressed && styles.pressedButton,
          ]}
        >
          <Ionicons color={colors.ink} name="refresh" size={typography.body.lineHeight} />
          <Text style={styles.retryText}>
            {registered ? t('pushCard.refresh') : t('pushCard.registerAgain')}
          </Text>
        </Pressable>
      </View>
    );
  },
);

function StatusLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statusLine}>
      <Text style={styles.messageLabel}>{label}</Text>
      <Text style={styles.statusValue}>{value}</Text>
    </View>
  );
}

function serverCapabilityLabel(
  state: PushRegistrationState,
  t: ReturnType<typeof useAppLanguage>['t'],
): string {
  if (state.serverCapability === 'enabled') return t('pushCard.enabled');
  if (state.serverCapability === 'disabled') return t('pushCard.disabled');
  if (state.serverCapability === 'unavailable') return t('pushCard.unavailable');
  return t('service.checking');
}

function systemPermissionLabel(
  state: PushRegistrationState,
  t: ReturnType<typeof useAppLanguage>['t'],
): string {
  if (state.systemPermission === 'granted') return t('pushCard.granted');
  if (state.systemPermission === 'denied') return t('pushCard.denied');
  if (state.systemPermission === 'checking') return t('service.checking');
  return t('pushCard.unknown');
}

function deviceRegistrationLabel(
  state: PushRegistrationState,
  t: ReturnType<typeof useAppLanguage>['t'],
): string {
  if (state.deviceRegistration === 'registered') return t('pushCard.registered');
  if (state.deviceRegistration === 'registering') return t('pushCard.registering');
  if (state.deviceRegistration === 'failed') return t('pushCard.registrationFailed');
  return t('pushCard.notRegistered');
}

function statusLabel(
  state: PushRegistrationState,
  t: ReturnType<typeof useAppLanguage>['t'],
): string {
  if (state.phase === 'registered') return t('pushCard.registered');
  if (['checking', 'fetching_token', 'registering'].includes(state.phase)) {
    return t('service.checking');
  }
  if (state.phase === 'server_disabled') return t('pushCard.disabled');
  if (state.phase === 'unsupported') return t('pushCard.unsupported');
  if (state.phase === 'permission_denied') return t('pushCard.unauthorized');
  return state.retryable ? t('pushCard.retryable') : t('pushCard.failed');
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
  },
  headingRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  eyebrow: {
    ...typography.label,
    color: textColors.secondary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
    letterSpacing: 1.2,
  },
  title: {
    ...typography.heading2,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
    marginTop: spacing.xs,
  },
  statusBadge: {
    alignItems: 'center',
    borderRadius: radii.round,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  onlineBadge: { backgroundColor: colors.successSurface },
  neutralBadge: { backgroundColor: colors.background },
  statusLabel: {
    ...typography.label,
    color: textColors.secondary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  onlineStatusLabel: { color: textColors.primary },
  messageBox: {
    backgroundColor: colors.background,
    borderRadius: radii.default,
    gap: spacing.xs,
    marginTop: spacing.lg,
    padding: spacing.md,
  },
  messageLabel: {
    ...typography.label,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  statusLine: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statusValue: {
    ...typography.label,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  message: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sans,
  },
  permissionNotice: {
    backgroundColor: colors.successSurface,
    borderRadius: radii.default,
    gap: spacing.xs,
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  permissionTitle: {
    ...typography.heading4,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  permissionText: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  diagnostic: {
    ...typography.label,
    color: textColors.tertiary,
    fontFamily: fontFamilies.sans,
  },
  retryButton: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    marginTop: spacing.md,
    minHeight: 48,
  },
  disabledButton: { backgroundColor: colors.card },
  pressedButton: { backgroundColor: colors.divider },
  retryText: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
});
