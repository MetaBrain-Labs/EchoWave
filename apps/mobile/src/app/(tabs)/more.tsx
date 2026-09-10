/**
 * 更多标签页面。
 *
 * 展示当前应用与 API 连接状态，为开发和用户提供可观察的 HelloWorld 健康检查。
 *
 * Responsibilities:
 * - 组合页面说明、服务状态、AI 配置与新手引导入口。
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
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';

/** 将“更多”页面渲染为统一的导航与引导入口。 */
export default function MoreScreen() {
  const router = useRouter();
  const { t } = useAppLanguage();
  const navigationCards = [
    { key: 'analysis', href: '/analysis' as Href, icon: 'pulse-outline' as const },
    { key: 'service', href: '/service-status' as Href, icon: 'options-outline' as const },
    { key: 'general', href: '/general-settings' as Href, icon: 'settings-outline' as const },
    { key: 'ai', href: '/settings' as Href, icon: 'build-outline' as const },
    { key: 'runtime', href: '/audio-runtime' as Href, icon: 'layers-outline' as const },
  ] as const;

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <TopLevelPageHeader subtitle={t('more.subtitle')} title={t('more.title')} />
      <ScrollView contentContainerStyle={styles.content} testID="more-scroll">
        {navigationCards.map((card) => (
          <Pressable
            accessibilityLabel={t(`more.${card.key}.accessibility`)}
            accessibilityRole="button"
            key={card.key}
            onPress={() => router.push(card.href)}
            style={({ pressed }) => [styles.navigationCard, pressed && styles.pressed]}
          >
            <View style={styles.navigationIcon}>
              <Ionicons color={colors.ink} name={card.icon} size={22} />
            </View>
            <View style={styles.navigationCopy}>
              <Text style={styles.navigationTitle}>{t(`more.${card.key}.title`)}</Text>
              <Text style={styles.navigationText}>{t(`more.${card.key}.description`)}</Text>
            </View>
            <Ionicons color={textColors.tertiary} name="chevron-forward" size={22} />
          </Pressable>
        ))}
        <Pressable
          accessibilityLabel={t('more.guides.accessibility')}
          accessibilityRole="button"
          onPress={() => router.push('/guides' as Href)}
          style={({ pressed }) => [styles.navigationCard, pressed && styles.pressed]}
        >
          <View style={styles.navigationIcon}>
            <Ionicons color={colors.ink} name="navigate-outline" size={22} />
          </View>
          <View style={styles.navigationCopy}>
            <Text style={styles.navigationTitle}>{t('more.guides.title')}</Text>
            <Text style={styles.navigationText}>{t('more.guides.description')}</Text>
          </View>
          <Ionicons color={textColors.tertiary} name="chevron-forward" size={22} />
        </Pressable>
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
