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
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';
import { TopLevelPageHeader } from '@/shared/ui/TopLevelPageHeader';

const navigationCards: readonly {
  accessibilityLabel: string;
  description: string;
  href: Href;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
}[] = [
  {
    accessibilityLabel: '打开分析',
    description: '查看音频分析流程、报告和失败任务。',
    href: '/analysis' as Href,
    icon: 'pulse-outline',
    title: '分析',
  },
  {
    accessibilityLabel: '打开服务状态',
    description: '检查 API 连接、数据库和基础服务可用性。',
    href: '/service-status' as Href,
    icon: 'pulse-outline',
    title: '服务状态',
  },
  {
    accessibilityLabel: '打开 AI 配置',
    description: '管理模型供应商、能力绑定和安全凭据。',
    href: '/settings' as Href,
    icon: 'options-outline',
    title: 'AI 配置',
  },
  {
    accessibilityLabel: '打开运行模式',
    description: '查看或切换混合、对象存储与轻量本地模式。',
    href: '/audio-runtime' as Href,
    icon: 'layers-outline',
    title: '运行模式',
  },
];

/** 将“更多”页面渲染为四个统一的导航入口。 */
export default function MoreScreen() {
  const router = useRouter();

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <TopLevelPageHeader subtitle="分析、服务诊断、AI 配置与音频运行策略。" title="更多" />
      <ScrollView contentContainerStyle={styles.content} testID="more-scroll">
        {navigationCards.map((card) => (
          <Pressable
            accessibilityLabel={card.accessibilityLabel}
            accessibilityRole="button"
            key={card.title}
            onPress={() => router.push(card.href)}
            style={({ pressed }) => [styles.navigationCard, pressed && styles.pressed]}
          >
            <View style={styles.navigationIcon}>
              <Ionicons color={colors.ink} name={card.icon} size={22} />
            </View>
            <View style={styles.navigationCopy}>
              <Text style={styles.navigationTitle}>{card.title}</Text>
              <Text style={styles.navigationText}>{card.description}</Text>
            </View>
            <Ionicons color={textColors.tertiary} name="chevron-forward" size={22} />
          </Pressable>
        ))}
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
  navigationCard: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.base,
    padding: spacing.md,
  },
  navigationIcon: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radii.round,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  navigationCopy: { flex: 1 },
  pressed: { opacity: 0.65 },
  navigationTitle: {
    ...typography.heading2,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
    marginBottom: spacing.xs,
  },
  navigationText: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
});
