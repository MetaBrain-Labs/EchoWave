import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ServiceStatusCard } from '../../features/service/ServiceStatusCard';
import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '../../theme/tokens';

export default function MoreScreen() {
  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>更多</Text>
        <Text style={styles.subtitle}>
          查看服务连接状态和即将开放的能力。
        </Text>
        <ServiceStatusCard />
        <View style={styles.roadmapCard}>
          <Text style={styles.roadmapTitle}>后续接入</Text>
          <Text style={styles.roadmapText}>
            PostgreSQL 与 Redis 已保留架构边界，本里程碑不会连接或启动这些服务。
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.canvas,
    flex: 1,
  },
  content: {
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
  },
  title: {
    ...typography.heading1,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
    marginTop: spacing.xl,
  },
  subtitle: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    marginBottom: spacing.xl,
    marginTop: spacing.sm,
  },
  roadmapCard: {
    backgroundColor: colors.background,
    borderRadius: radii.default,
    marginTop: spacing.md,
    padding: spacing.lg,
  },
  roadmapTitle: {
    ...typography.heading2,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
    marginBottom: spacing.xs,
  },
  roadmapText: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
});
