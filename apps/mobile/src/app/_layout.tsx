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
import { Slot } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { NavigationLoadingProvider } from '@/shared/navigation/NavigationLoadingProvider';
import {
  colors,
  fontFamilies,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';

/** 装载应用级 provider、字体门禁与根路由栈。 */
export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    [fontFamilies.kai]: require('../../assets/fonts/LXGWWenKaiLite-Regular.ttf'),
    [fontFamilies.sans]: require('../../assets/fonts/SourceHanSansCN-Regular.otf'),
    [fontFamilies.sansBold]: require('../../assets/fonts/SourceHanSansCN-Bold.otf'),
  });

  if (fontError) {
    return (
      <FontGateState
        description="请重新启动应用后重试。"
        title="字体加载失败"
      />
    );
  }

  if (!fontsLoaded) {
    return <FontGateState loading title="正在加载字体" />;
  }

  return (
    <SafeAreaProvider>
      <View style={styles.stage}>
        <View style={styles.canvas}>
          <NavigationLoadingProvider>
            <Slot />
            <StatusBar style="dark" />
          </NavigationLoadingProvider>
        </View>
      </View>
    </SafeAreaProvider>
  );
}

function FontGateState({
  description,
  loading = false,
  title,
}: {
  description?: string;
  loading?: boolean;
  title: string;
}) {
  return (
    <SafeAreaProvider>
      <View accessibilityRole="alert" style={styles.fontGate}>
        {loading ? <ActivityIndicator color={colors.ink} /> : null}
        <Text style={styles.fontGateTitle}>{title}</Text>
        {description ? (
          <Text style={styles.fontGateDescription}>{description}</Text>
        ) : null}
      </View>
    </SafeAreaProvider>
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
});
