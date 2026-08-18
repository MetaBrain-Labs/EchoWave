/** Constrains the universal app to a centered mobile canvas on wide web screens. */
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

import { NavigationLoadingProvider } from '../components/NavigationLoadingProvider';
import {
  colors,
  fontFamilies,
  spacing,
  textColors,
  typography,
} from '../theme/tokens';

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
