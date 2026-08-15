/** Presents observable HelloWorld connectivity with explicit retry and failure states. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors, radii, spacing, typeScale } from '../../theme/tokens';
import { apiUrl, fetchHello } from './apiClient';

type ServiceState =
  | { phase: 'loading' }
  | { phase: 'online'; message: string }
  | { phase: 'offline'; message: string };

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
            <ActivityIndicator color={colors.secondary} size="small" />
          ) : (
            <Ionicons
              color={isOnline ? colors.success : colors.secondary}
              name={isOnline ? 'checkmark-circle' : 'cloud-offline-outline'}
              size={17}
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
        <Ionicons color={colors.white} name="refresh" size={18} />
        <Text style={styles.retryText}>重试连接</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderColor: colors.divider,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
  },
  headingRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  eyebrow: {
    color: colors.secondary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  title: {
    color: colors.ink,
    fontSize: 26,
    fontWeight: '700',
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
    color: colors.secondary,
    fontSize: typeScale.caption,
    fontWeight: '700',
  },
  onlineStatusLabel: {
    color: colors.success,
  },
  messageBox: {
    backgroundColor: colors.background,
    borderRadius: radii.md,
    marginTop: spacing.lg,
    padding: spacing.md,
  },
  messageLabel: {
    color: colors.muted,
    fontSize: typeScale.caption,
    marginBottom: spacing.xs,
  },
  message: {
    color: colors.ink,
    fontSize: typeScale.body,
    lineHeight: 23,
  },
  endpoint: {
    color: colors.muted,
    fontSize: 12,
    marginTop: spacing.md,
  },
  retryButton: {
    alignItems: 'center',
    backgroundColor: colors.ink,
    borderRadius: radii.md,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    marginTop: spacing.md,
    minHeight: 48,
  },
  disabledButton: {
    opacity: 0.5,
  },
  pressedButton: {
    opacity: 0.7,
  },
  retryText: {
    color: colors.white,
    fontSize: typeScale.body,
    fontWeight: '700',
  },
});
