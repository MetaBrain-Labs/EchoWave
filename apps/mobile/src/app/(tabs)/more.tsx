/**
 * 更多标签页面。
 *
 * 在首屏直接给出服务器连通与运行模式摘要，并提供通往产品功能区、设置与引导的入口。
 *
 * Responsibilities:
 * - 组合服务器状态摘要、页面说明、配置入口与新手引导入口。
 * - 只绑定导航回调，不持有服务器状态。
 *
 * Notes:
 * - 摘要卡只读观测，权威状态仍由服务端与各配置页持有。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter, type Href } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ServiceSummaryCard } from '@/features/system-status/ServiceSummaryCard';
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
import { useStarterTourTarget } from '@/shared/onboarding/StarterTourContext';

/** 将“更多”页面渲染为统一的导航与引导入口。 */
export default function MoreScreen() {
  const router = useRouter();
  const { t } = useAppLanguage();
  const collectionEntryRef = useStarterTourTarget('collection-entry');
  // AI 配置与运行模式都属于租户级服务配置，由“服务配置”页统一承载，避免重复入口。
  const navigationCards = [
    { key: 'collection', href: '/collection' as Href, icon: 'library-outline' as const },
    { key: 'analysis', href: '/analysis' as Href, icon: 'pulse-outline' as const },
    { key: 'service', href: '/service-status' as Href, icon: 'options-outline' as const },
    { key: 'general', href: '/general-settings' as Href, icon: 'settings-outline' as const },
    {
      key: 'serviceConfig',
      href: '/service-configuration' as Href,
      icon: 'construct-outline' as const,
    },
  ] as const;

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <TopLevelPageHeader subtitle={t('more.subtitle')} title={t('more.title')} />
      <ScrollView contentContainerStyle={styles.content} testID="more-scroll">
        <ServiceSummaryCard onOpenDetails={() => router.push('/service-status' as Href)} />
        {navigationCards.map((card) => (
          <Pressable
            accessibilityLabel={t(`more.${card.key}.accessibility`)}
            accessibilityRole="button"
            key={card.key}
            onPress={() => router.push(card.href)}
            ref={card.key === 'collection' ? collectionEntryRef : undefined}
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
  pressed: { backgroundColor: colors.background },
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
