/**
 * API 服务状态卡片。
 *
 * 以可观察、可重试的方式展示 HelloWorld 连接状态，区分加载、在线、离线和超时反馈。
 *
 * Responsibilities:
 * - 触发并展示健康检查结果。
 * - 提供失败后的显式重试操作。
 *
 * Notes:
 * - 状态仅用于当前卡片生命周期。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';
import { apiUrl } from '@/shared/api/apiUrl';

import { fetchHello } from './apiClient';

type ServiceState =
  | { phase: 'loading' }
  | { phase: 'online'; message: string }
  | { phase: 'offline'; message: string };

/** 执行 HelloWorld 健康检查并渲染加载、在线、失败和重试状态。 */
export function ServiceStatusCard() {
  const [state, setState] = useState<ServiceState>({ phase: 'loading' });
  const requestVersion = useRef(0);

  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    setState({ phase: 'loading' });

    try {
      const response = await fetchHello();
      if (version === requestVersion.current) {
        setState({ phase: 'online', message: response.message });
      }
    } catch (error) {
      if (version === requestVersion.current) {
        setState({
          phase: 'offline',
          message:
            error instanceof Error ? error.message : '无法连接 EchoWave API。',
        });
      }
    }
  }, []);

  useEffect(() => {
    const version = ++requestVersion.current;
    void fetchHello()
      .then((response) => {
        if (version === requestVersion.current) {
          setState({ phase: 'online', message: response.message });
        }
      })
      .catch((error: unknown) => {
        if (version === requestVersion.current) {
          setState({
            phase: 'offline',
            message:
              error instanceof Error ? error.message : '无法连接 EchoWave API。',
          });
        }
      });

    return () => {
      requestVersion.current += 1;
    };
  }, []);

  const isLoading = state.phase === 'loading';
  const isOnline = state.phase === 'online';

  return (
    <View style={styles.card}>
      <View style={styles.headingRow}>
        <View>
          <Text style={styles.eyebrow}>HELLOWORLD API</Text>
          <Text style={styles.title}>服务状态</Text>
        </View>
        <View
          accessibilityLabel={isLoading ? '检测中' : isOnline ? '在线' : '离线'}
          style={[
            styles.statusBadge,
            isOnline ? styles.onlineBadge : styles.neutralBadge,
          ]}
        >
          {isLoading ? (
            <ActivityIndicator
              color={colors.secondary}
              size={typography.label.lineHeight}
            />
          ) : (
            <Ionicons
              color={isOnline ? colors.success : colors.secondary}
              name={isOnline ? 'checkmark-circle' : 'cloud-offline-outline'}
              size={typography.label.lineHeight}
            />
          )}
          <Text
            style={[styles.statusLabel, isOnline && styles.onlineStatusLabel]}
          >
            {isLoading ? '检测中' : isOnline ? '在线' : '离线'}
          </Text>
        </View>
      </View>

      <View style={styles.messageBox}>
        <Text style={styles.messageLabel}>返回消息</Text>
        <Text style={styles.message}>
          {isLoading
            ? '正在连接 EchoWave API…'
            : state.phase === 'online'
              ? state.message
              : state.message}
        </Text>
      </View>

      <Text numberOfLines={1} style={styles.endpoint}>
        {apiUrl}/api/hello
      </Text>

      <Pressable
        accessibilityLabel="重试连接"
        accessibilityRole="button"
        disabled={isLoading}
        onPress={() => void refresh()}
        style={({ pressed }) => [
          styles.retryButton,
          isLoading && styles.disabledButton,
          pressed && styles.pressedButton,
        ]}
      >
        <Ionicons
          color={colors.ink}
          name="refresh"
          size={typography.body.lineHeight}
        />
        <Text style={styles.retryText}>重试连接</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
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
});
