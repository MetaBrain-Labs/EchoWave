/**
 * 更多标签页面。
 *
 * 展示当前应用与 API 连接状态，为开发和用户提供可观察的 HelloWorld 健康检查。
 *
 * Responsibilities:
 * - 组合页面说明与服务状态卡片。
 *
 * Notes:
 * - 不保存服务器健康状态。
 */
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ServiceStatusCard } from '@/features/system-status/ServiceStatusCard';
import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';

/** 组合更多页面说明与 API 服务状态。 */
export default function MoreScreen() {
  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>更多</Text>
        <Text style={styles.subtitle}>查看服务连接状态和即将开放的能力。</Text>
        <ServiceStatusCard />
        <View style={styles.roadmapCard}>
          <Text style={styles.roadmapTitle}>后续接入</Text>
          <Text style={styles.roadmapText}>
            PostgreSQL 已承载知识库与音频工作区数据；Redis 仍保留为未来协调边界。
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
