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
    const { state, refresh } = usePushNotificationRegistration();
    useImperativeHandle(ref, () => ({ refresh }), [refresh]);
    const loading = ['checking', 'fetching_token', 'registering'].includes(state.phase);
    const registered = state.phase === 'registered';
    const label = statusLabel(state);

    return (
      <View style={styles.card} testID="push-notification-status-card">
        <View style={styles.headingRow}>
          <View>
            <Text style={styles.eyebrow}>REMOTE PUSH</Text>
            <Text style={styles.title}>推送通知</Text>
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
          <StatusLine label="服务端能力" value={serverCapabilityLabel(state)} />
          <StatusLine label="系统权限" value={systemPermissionLabel(state)} />
          <StatusLine label="设备登记" value={deviceRegistrationLabel(state)} />
          <Text style={styles.message}>{state.message}</Text>
          {state.errorCode ? <Text style={styles.diagnostic}>代码：{state.errorCode}</Text> : null}
          {state.lastAttemptAt ? (
            <Text style={styles.diagnostic}>
              最近尝试：{new Date(state.lastAttemptAt).toLocaleString('zh-CN')}
            </Text>
          ) : null}
        </View>

        <View style={styles.permissionNotice}>
          <Text style={styles.permissionTitle}>权限说明</Text>
          <Text style={styles.permissionText}>
            服务端能力需要服务端开启远程推送；系统权限需要允许 EchoWave
            发送通知；设备登记需要获取推送设备令牌。
          </Text>
          <Text style={styles.permissionText}>
            Android 设备还需要能访问 Google 推送服务（Google Play services /
            FCM），否则可能无法获取令牌并完成登记。
          </Text>
        </View>

        <Pressable
          accessibilityLabel="重新登记推送设备"
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
          <Text style={styles.retryText}>{registered ? '刷新登记' : '重新登记'}</Text>
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

function serverCapabilityLabel(state: PushRegistrationState): string {
  if (state.serverCapability === 'enabled') return '已启用';
  if (state.serverCapability === 'disabled') return '未启用';
  if (state.serverCapability === 'unavailable') return '不可用';
  return '检查中';
}

function systemPermissionLabel(state: PushRegistrationState): string {
  if (state.systemPermission === 'granted') return '已允许';
  if (state.systemPermission === 'denied') return '未允许';
  if (state.systemPermission === 'checking') return '检查中';
  return '未知';
}

function deviceRegistrationLabel(state: PushRegistrationState): string {
  if (state.deviceRegistration === 'registered') return '已登记';
  if (state.deviceRegistration === 'registering') return '登记中';
  if (state.deviceRegistration === 'failed') return '登记失败';
  return '未登记';
}

function statusLabel(state: PushRegistrationState): string {
  if (state.phase === 'registered') return '已登记';
  if (['checking', 'fetching_token', 'registering'].includes(state.phase)) return '检测中';
  if (state.phase === 'server_disabled') return '未启用';
  if (state.phase === 'unsupported') return '不支持';
  if (state.phase === 'permission_denied') return '未授权';
  return state.retryable ? '可重试' : '失败';
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
