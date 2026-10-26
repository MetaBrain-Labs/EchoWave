/**
 * 桌面页面路径导航。
 *
 * 在宽屏详情和列表页呈现返回、工作区首页、所属现有区域与当前标题。
 *
 * Responsibilities:
 * - 通过现有 Expo Router 路由提供可操作的页面层级。
 * - 优先使用调用方现有返回回调，直接打开深层链接时回到所属区域。
 *
 * Notes:
 * - 只映射 EchoWave 当前已有路由，不创建新的业务入口。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { usePathname, useRouter, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import { colors, radii, spacing, textColors, typography } from '@/shared/theme/tokens';

type DesktopSection = {
  href: Href;
  labelKey: 'tabs.groups' | 'tabs.knowledge' | 'tabs.create' | 'tabs.analysis' | 'tabs.more';
};

/** 将当前现有路由归属到工作区的五个入口之一。 */
function resolveSection(pathname: string): DesktopSection {
  const path = pathname.replace(/^\/\([^/]+\)/u, '') || '/';
  if (path === '/' || path.startsWith('/groups')) return { href: '/', labelKey: 'tabs.groups' };
  if (path.startsWith('/knowledge')) return { href: '/knowledge', labelKey: 'tabs.knowledge' };
  if (path === '/create' || path === '/recording' || path === '/analysis-create') {
    return { href: '/create', labelKey: 'tabs.create' };
  }
  if (path.startsWith('/sources') || path.startsWith('/analysis')) {
    return { href: '/sources', labelKey: 'tabs.analysis' };
  }
  return { href: '/more', labelKey: 'tabs.more' };
}

/** 渲染可返回并可跳转到已有父级路由的桌面面包屑。 */
export function DesktopBreadcrumb({
  current,
  onBack,
  style,
}: {
  current: string;
  onBack?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useAppLanguage();
  const path = pathname.replace(/^\/\([^/]+\)/u, '') || '/';
  const section = resolveSection(pathname);
  const sectionPath = typeof section.href === 'string' ? section.href : section.href.pathname;
  const showSection = path !== sectionPath;

  const handleBack = () => {
    if (onBack) {
      onBack();
      return;
    }
    if (router.canGoBack?.()) {
      router.back();
      return;
    }
    router.navigate(section.href);
  };

  return (
    <View
      accessibilityLabel={t('desktop.breadcrumb.label')}
      accessibilityRole="summary"
      style={[styles.breadcrumb, style]}
      testID="desktop-breadcrumb"
    >
      <Pressable
        accessibilityLabel={t('common.back')}
        accessibilityRole="button"
        hitSlop={8}
        onPress={handleBack}
        style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        testID="desktop-breadcrumb-back"
      >
        <Ionicons color={textColors.secondary} name="chevron-back" size={19} />
      </Pressable>
      <Pressable
        accessibilityLabel={t('desktop.breadcrumb.home')}
        accessibilityRole="link"
        hitSlop={8}
        onPress={() => router.navigate('/')}
        style={({ pressed }) => [styles.homeButton, pressed && styles.pressed]}
        testID="desktop-breadcrumb-home"
      >
        <Ionicons color={textColors.secondary} name="home-outline" size={15} />
      </Pressable>
      <Ionicons color={textColors.tertiary} name="chevron-forward" size={13} />
      {showSection ? (
        <>
          <Pressable
            accessibilityLabel={t(section.labelKey)}
            accessibilityRole="link"
            hitSlop={8}
            onPress={() => router.navigate(section.href)}
            style={({ pressed }) => [styles.sectionLink, pressed && styles.pressed]}
          >
            <Text numberOfLines={1} style={styles.sectionText}>
              {t(section.labelKey)}
            </Text>
          </Pressable>
          <Ionicons color={textColors.tertiary} name="chevron-forward" size={13} />
        </>
      ) : null}
      <Text accessibilityRole="header" numberOfLines={1} style={styles.current}>
        {current}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  breadcrumb: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 32,
    minWidth: 0,
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: radii.round,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  homeButton: {
    alignItems: 'center',
    borderRadius: radii.round,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  sectionLink: { flexShrink: 1, maxWidth: 220 },
  sectionText: { ...typography.description, color: textColors.secondary },
  current: { ...typography.description, color: colors.primary, flexShrink: 1 },
  pressed: { backgroundColor: colors.primarySurface, borderRadius: radii.round },
});
