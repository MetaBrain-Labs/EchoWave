/**
 * API 服务状态卡片。
 *
 * 以可观察、可重试的方式展示当前 EchoWave Server 的身份、版本和连接状态。
 *
 * Responsibilities:
 * - 触发并展示健康检查结果。
 * - 提供失败后的显式重试操作。
 *
 * Notes:
 * - 状态仅用于当前卡片生命周期。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';
import { useServerConnection } from '@/shared/api/ServerConnectionProvider';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';

import { fetchServerHealth } from './apiClient';

type ServiceState =
  | { phase: 'loading' }
  | { phase: 'online'; message: string }
  | { phase: 'offline'; message: string };

/** 服务状态卡暴露给宿主页面复用的刷新句柄。 */
export type ServiceStatusCardHandle = {
  refresh: () => Promise<void>;
};

/** 执行健康检查并渲染加载、在线、失败、重试和修改服务器操作。 */
export const ServiceStatusCard = forwardRef<
  ServiceStatusCardHandle,
  { onChangeServer: () => void }
>(function ServiceStatusCard({ onChangeServer }, ref) {
  const { t } = useAppLanguage();
  const { serverUrl } = useServerConnection();
  const [state, setState] = useState<ServiceState>({ phase: 'loading' });
  const requestVersion = useRef(0);

  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    setState({ phase: 'loading' });

    if (!serverUrl) {
      setState({ phase: 'offline', message: t('service.configure') });
      return;
    }

    try {
      const response = await fetchServerHealth(serverUrl!);
      if (version === requestVersion.current) {
        setState({
          phase: 'online',
          message: `EchoWave ${response.version} · API v${response.apiVersion}`,
        });
      }
    } catch (error) {
      if (version === requestVersion.current) {
        setState({
          phase: 'offline',
          message: error instanceof Error ? error.message : t('service.unreachable'),
        });
      }
    }
  }, [serverUrl, t]);
  useImperativeHandle(ref, () => ({ refresh }), [refresh]);

  useEffect(() => {
    const version = ++requestVersion.current;
    if (!serverUrl) return;
    void fetchServerHealth(serverUrl)
      .then((response) => {
        if (version === requestVersion.current) {
          setState({
            phase: 'online',
            message: `EchoWave ${response.version} · API v${response.apiVersion}`,
          });
        }
      })
      .catch((error: unknown) => {
        if (version === requestVersion.current) {
          setState({
            phase: 'offline',
            message: error instanceof Error ? error.message : t('service.unreachable'),
          });
        }
      });

    return () => {
      requestVersion.current += 1;
    };
  }, [serverUrl, t]);

  const isLoading = state.phase === 'loading';
  const isOnline = state.phase === 'online';

  return (
    <View style={styles.card} testID="service-status-card">
      <View style={styles.headingRow}>
        <View>
          <Text style={styles.eyebrow}>ECHOWAVE SERVER</Text>
          <Text style={styles.title}>{t('more.service.title')}</Text>
        </View>
        <View
          accessibilityLabel={
            isLoading
              ? t('service.checking')
              : isOnline
                ? t('service.online')
                : t('service.offline')
          }
          style={[styles.statusBadge, isOnline ? styles.onlineBadge : styles.neutralBadge]}
        >
          {isLoading ? (
            <ActivityIndicator color={colors.secondary} size={typography.label.lineHeight} />
          ) : (
            <Ionicons
              color={isOnline ? colors.success : colors.secondary}
              name={isOnline ? 'checkmark-circle' : 'cloud-offline-outline'}
              size={typography.label.lineHeight}
            />
          )}
          <Text style={[styles.statusLabel, isOnline && styles.onlineStatusLabel]}>
            {isLoading
              ? t('service.checking')
              : isOnline
                ? t('service.online')
                : t('service.offline')}
          </Text>
        </View>
      </View>

      <View style={styles.messageBox}>
        <Text style={styles.messageLabel}>{t('service.response')}</Text>
        <Text style={styles.message}>
          {isLoading
            ? t('service.connecting')
            : state.phase === 'online'
              ? state.message
              : state.message}
        </Text>
      </View>

      <Text numberOfLines={1} style={styles.endpoint}>
        {serverUrl}/health
      </Text>

      <Pressable
        accessibilityLabel={t('service.retry')}
        accessibilityRole="button"
        disabled={isLoading}
        onPress={() => void refresh()}
        style={({ pressed }) => [
          styles.retryButton,
          isLoading && styles.disabledButton,
          pressed && styles.pressedButton,
        ]}
      >
        <Ionicons color={colors.ink} name="refresh" size={typography.body.lineHeight} />
        <Text style={styles.retryText}>{t('service.retry')}</Text>
      </Pressable>
      <Pressable
        accessibilityLabel={t('service.change')}
        accessibilityRole="button"
        onPress={onChangeServer}
        style={({ pressed }) => [styles.changeButton, pressed && styles.pressedButton]}
      >
        <Ionicons
          color={textColors.secondary}
          name="server-outline"
          size={typography.body.lineHeight}
        />
        <Text style={styles.changeText}>{t('service.change')}</Text>
      </Pressable>
    </View>
  );
});

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
  onlineBadge: {
    backgroundColor: colors.successSurface,
  },
  neutralBadge: {
    backgroundColor: colors.background,
  },
  statusLabel: {
    ...typography.label,
    color: textColors.secondary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  onlineStatusLabel: {
    color: textColors.primary,
  },
  messageBox: {
    backgroundColor: colors.background,
    borderRadius: radii.default,
    marginTop: spacing.lg,
    padding: spacing.md,
  },
  messageLabel: {
    ...typography.label,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    marginBottom: spacing.xs,
  },
  message: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sans,
  },
  endpoint: {
    ...typography.label,
    color: textColors.tertiary,
    fontFamily: fontFamilies.sans,
    marginTop: spacing.md,
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
  disabledButton: {
    backgroundColor: colors.card,
  },
  pressedButton: {
    backgroundColor: colors.divider,
  },
  retryText: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  changeButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    marginTop: spacing.sm,
    minHeight: 44,
  },
  changeText: {
    ...typography.body,
    color: textColors.secondary,
  },
});
