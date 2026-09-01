/**
 * 更多标签页面。
 *
 * 展示当前应用与 API 连接状态，为开发和用户提供可观察的 HelloWorld 健康检查。
 *
 * Responsibilities:
 * - 组合页面说明、服务状态与 AI 配置入口。
 *
 * Notes:
 * - 不保存服务器健康状态。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ServiceStatusCard } from '@/features/system-status/ServiceStatusCard';
import { settingsApi } from '@/shared/api/settingsApi';
import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';
import { TopLevelPageHeader } from '@/shared/ui/TopLevelPageHeader';

/** 组合更多页面说明与 API 服务状态。 */
export default function MoreScreen() {
  const router = useRouter();
  const [security, setSecurity] = useState('正在检测连接安全性');

  useEffect(() => {
    settingsApi
      .transport()
      .then((value) =>
        setSecurity(
          value.secretSubmissionAllowed
            ? '连接安全，可管理 Database Credential'
            : '远程 HTTP，仅允许普通配置和 Local Credential alias',
        ),
      )
      .catch(() => setSecurity('暂时无法读取配置健康状态'));
  }, []);

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <TopLevelPageHeader subtitle="查看服务连接状态和即将开放的能力。" title="更多" />
      <ScrollView contentContainerStyle={styles.content} testID="more-scroll">
        <ServiceStatusCard />
        <Pressable
          accessibilityLabel="打开 AI 配置"
          accessibilityRole="button"
          onPress={() => router.push('/settings' as Href)}
          style={({ pressed }) => [styles.settingsCard, pressed && styles.pressed]}
        >
          <View style={styles.settingsIcon}>
            <Ionicons color={colors.ink} name="options-outline" size={22} />
          </View>
          <View style={styles.settingsCopy}>
            <Text style={styles.roadmapTitle}>AI 配置</Text>
            <Text style={styles.roadmapText}>{security}</Text>
          </View>
          <Ionicons color={textColors.tertiary} name="chevron-forward" size={22} />
        </Pressable>
        <View style={styles.roadmapCard} testID="more-roadmap-card">
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
    gap: spacing.sm,
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.md,
  },
  roadmapCard: {
    backgroundColor: colors.card,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
  },
  settingsCard: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.base,
    padding: spacing.md,
  },
  settingsIcon: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radii.round,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  settingsCopy: { flex: 1 },
  pressed: { opacity: 0.65 },
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
