/** Constrains the universal app to a centered mobile canvas on wide web screens. */
import { Slot } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Platform, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { colors } from '../theme/tokens';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <View style={styles.stage}>
        <View style={styles.canvas}>
          <Slot />
          <StatusBar style="dark" />
        </View>
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
});
