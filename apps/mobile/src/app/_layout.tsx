/**
 * 移动应用根布局。
 *
 * 装载字体、安全区、导航加载状态与 Expo Router 栈，并在桌面 Web 上约束居中的单列画布。
 *
 * Responsibilities:
 * - 初始化跨平台应用级 provider。
 * - 定义根路由栈和全局画布约束。
 *
 * Notes:
 * - 业务页面状态不得提升到此组合根。
 */
import { useFonts } from 'expo-font';
import { Stack, useRouter, type Href } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { NavigationLoadingProvider } from '@/shared/navigation/NavigationLoadingProvider';
import { ServerConnectionScreen } from '@/features/server-connection/ServerConnectionScreen';
import { fetchServerHealth } from '@/shared/api/serverHealth';
import {
  ServerConnectionProvider,
  useServerConnection,
} from '@/shared/api/ServerConnectionProvider';
import {
  registerPushDevice,
  subscribeToNotificationNavigation,
} from '@/shared/notifications/pushNotifications';
import { colors, fontFamilies, spacing, textColors, typography } from '@/shared/theme/tokens';
import { StatusBarBackdrop } from '@/shared/ui/StatusBarBackdrop';

/** 装载应用级 provider、字体门禁与根路由栈。 */
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ServerConnectionProvider>
        <RootContent />
      </ServerConnectionProvider>
    </SafeAreaProvider>
  );
}

/** 在服务器地址完成水合后挂载应用路由与远程推送。 */
function RootContent() {
  const router = useRouter();
  const connection = useServerConnection();
  const [fontsLoaded, fontError] = useFonts({
    [fontFamilies.kai]: require('../../assets/fonts/LXGWWenKaiLite-Regular.ttf'),
    [fontFamilies.sans]: require('../../assets/fonts/SourceHanSansCN-Regular.otf'),
    [fontFamilies.sansBold]: require('../../assets/fonts/SourceHanSansCN-Bold.otf'),
  });

  useEffect(() => {
    if (connection.phase !== 'ready' || !connection.serverUrl) return;
    let active = true;
    let unsubscribe: () => void = () => undefined;
    void fetchServerHealth(connection.serverUrl)
      .then((health) => {
        if (!active || !health.capabilities.remotePush) return;
        void registerPushDevice().catch(() => undefined);
        unsubscribe = subscribeToNotificationNavigation((id) => {
          router.push({ pathname: '/analysis-batches/[id]', params: { id } } as unknown as Href);
        });
      })
      .catch(() => undefined);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [connection.phase, connection.revision, connection.serverUrl, router]);

  if (fontError) {
    return <FontGateState description="请重新启动应用后重试。" title="字体加载失败" />;
  }

  if (!fontsLoaded) {
    return <FontGateState loading title="正在加载字体" />;
  }

  if (connection.phase === 'loading') {
    return <FontGateState loading title="正在读取服务器设置" />;
  }

  if (connection.phase === 'error') {
    return (
      <FontGateState
        actionLabel="重试"
        description={connection.error ?? '无法读取服务器设置。'}
        onAction={connection.retryHydration}
        title="服务器设置读取失败"
      />
    );
  }

  if (connection.phase === 'unconfigured') return <ServerConnectionScreen />;

  return (
    <View style={styles.stage}>
      <View style={styles.canvas}>
        <NavigationLoadingProvider key={connection.revision}>
          <Stack screenOptions={{ headerShown: false }} />
          <StatusBar style="dark" />
          <StatusBarBackdrop />
        </NavigationLoadingProvider>
      </View>
    </View>
  );
}

function FontGateState({
  actionLabel,
  description,
  loading = false,
  onAction,
  title,
}: {
  actionLabel?: string;
  description?: string;
  loading?: boolean;
  onAction?: () => void;
  title: string;
}) {
  return (
    <View accessibilityRole="alert" style={styles.fontGate}>
      {loading ? <ActivityIndicator color={colors.ink} /> : null}
      <Text style={styles.fontGateTitle}>{title}</Text>
      {description ? <Text style={styles.fontGateDescription}>{description}</Text> : null}
      {actionLabel && onAction ? (
        <Text accessibilityRole="button" onPress={onAction} style={styles.fontGateAction}>
          {actionLabel}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    alignItems: 'center',
    backgroundColor: colors.background,
    flex: 1,
  },
  canvas: {
    backgroundColor: colors.canvas,
    flex: 1,
    maxWidth: 480,
    overflow: Platform.OS === 'web' ? 'hidden' : 'visible',
    width: '100%',
  },
  fontGate: {
    alignItems: 'center',
    backgroundColor: colors.canvas,
    flex: 1,
    gap: spacing.sm,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  fontGateTitle: {
    ...typography.body,
    color: textColors.primary,
    fontWeight: 'bold',
  },
  fontGateDescription: {
    ...typography.description,
    color: textColors.secondary,
    textAlign: 'center',
  },
  fontGateAction: {
    ...typography.body,
    color: colors.ink,
    fontWeight: 'bold',
    marginTop: spacing.sm,
    padding: spacing.sm,
  },
});
