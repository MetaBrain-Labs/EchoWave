/**
 * EchoWave 桌面工作区外壳。
 *
 * 在宽屏 Web 展示产品导航、当前页面搜索和语言切换，同时保留现有 Expo 路由树。
 *
 * Responsibilities:
 * - 在 960px 及以上 Web 视口显示固定导航与顶栏。
 * - 将既有页面搜索临时连接到桌面顶栏，不拥有搜索或业务状态。
 * - 在窄屏 Web 与原生平台保留移动画布和页面结构。
 *
 * Notes:
 * - 桌面菜单只连接本项目已有路由；服务与管理入口仍由“更多”页面管理。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { usePathname, useRouter, type Href } from 'expo-router';
import { useEffect, useRef, type PropsWithChildren } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';
import { DESKTOP_NAVIGATION_WIDTH } from '@/shared/ui/layoutMetrics';
import { useResponsiveLayout } from '@/shared/ui/useResponsiveLayout';
import { textInputText } from '@/shared/theme/textInput';
import { WorkspaceAmbientBackground } from '@/shared/ui/WorkspaceAmbientBackground';
import {
  TopBarSearchContext,
  useTopBarSearch,
  useTopBarSearchRegistry,
} from '@/shared/ui/TopBarSearchContext';

const destinations = [
  { href: '/(tabs)', icon: 'albums-outline', key: 'tabs.groups', id: 'groups' },
  { href: '/knowledge', icon: 'book-outline', key: 'tabs.knowledge', id: 'knowledge' },
  { href: '/create', icon: 'add-circle-outline', key: 'tabs.create', id: 'create' },
  { href: '/sources', icon: 'stats-chart-outline', key: 'tabs.analysis', id: 'analysis' },
  { href: '/more', icon: 'grid-outline', key: 'tabs.more', id: 'more' },
] as const;

/** 为桌面工作区提供纯展示壳层，移动端继续使用五个底部页签。 */
export function DesktopWorkspaceShell({ children }: PropsWithChildren) {
  const { desktop, width } = useResponsiveLayout();
  const searchRegistry = useTopBarSearchRegistry();

  return (
    <TopBarSearchContext.Provider value={searchRegistry}>
      <View style={[styles.shell, desktop && styles.desktopShell]} testID="workspace-shell">
        <WorkspaceAmbientBackground active />
        {desktop ? <DesktopNavigation /> : null}
        <View style={styles.contentColumn}>
          {desktop ? <DesktopTopBar width={width} /> : null}
          <View style={[styles.page, desktop && styles.desktopPage]}>{children}</View>
        </View>
      </View>
    </TopBarSearchContext.Provider>
  );
}

/** 展示指向五个现有顶层产品区域的桌面侧栏。 */
function DesktopNavigation() {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useAppLanguage();

  return (
    <View
      accessibilityLabel={t('desktop.navigation')}
      style={styles.sidebar}
      testID="desktop-workspace-navigation"
    >
      <View style={styles.brand}>
        <View style={styles.brandMark}>
          <Ionicons color={colors.white} name="pulse" size={21} />
        </View>
        <Text style={styles.brandText}>EchoWave</Text>
      </View>
      <ScrollView contentContainerStyle={styles.navigationItems}>
        {destinations.map((destination) => {
          const selected = matchesDestination(pathname, destination.id);
          return (
            <Pressable
              accessibilityRole="link"
              accessibilityState={{ selected }}
              key={destination.id}
              onPress={() => router.navigate(destination.href as Href)}
              style={({ pressed }) => [
                styles.navigationItem,
                selected && styles.navigationItemSelected,
                pressed && styles.navigationItemPressed,
              ]}
              testID={`desktop-nav-${destination.id}`}
            >
              <Ionicons
                color={selected ? colors.primary : textColors.secondary}
                name={destination.icon}
                size={19}
              />
              <Text style={[styles.navigationLabel, selected && styles.navigationLabelSelected]}>
                {t(destination.key)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <Text style={styles.sidebarFooter}>EchoWave · {t('desktop.localDeployment')}</Text>
    </View>
  );
}

/** 集中显示当前页面注册的搜索框与已有语言切换。 */
function DesktopTopBar({ width }: { width: number }) {
  const { t, language, setLanguage } = useAppLanguage();
  const { snapshot } = useTopBarSearch();
  const searchInputRef = useRef<TextInput>(null);
  const registration = snapshot.current;

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const input = searchInputRef.current as unknown as HTMLInputElement | null;
    const value = registration?.value ?? '';
    if (input && input.value !== value) input.value = value;
  }, [registration?.placeholder, registration?.value]);

  const compact = width < 1180;

  return (
    <View accessibilityLabel={t('desktop.topBar.label')} style={styles.topBar}>
      <View
        style={[styles.searchField, !registration && styles.searchFieldDisabled]}
        testID="desktop-top-bar-search"
      >
        <Ionicons color={textColors.tertiary} name="search-outline" size={18} />
        <TextInput
          accessibilityLabel={t('desktop.search')}
          accessibilityState={{ disabled: !registration }}
          defaultValue={Platform.OS === 'web' ? (registration?.value ?? '') : undefined}
          editable={Boolean(registration)}
          onChangeText={registration?.onChange}
          placeholder={registration?.placeholder ?? t('desktop.search')}
          placeholderTextColor={textColors.tertiary}
          ref={searchInputRef}
          returnKeyType="search"
          style={styles.searchInput}
        />
      </View>
      <Pressable
        accessibilityLabel={t('desktop.language')}
        accessibilityRole="button"
        onPress={() => setLanguage(language === 'en' ? 'zh-CN' : 'en')}
        style={({ pressed }) => [
          styles.languageButton,
          compact && styles.languageButtonCompact,
          pressed && styles.navigationItemPressed,
        ]}
        testID="desktop-language-toggle"
      >
        <Ionicons color={textColors.secondary} name="language-outline" size={18} />
        {!compact ? (
          <Text style={styles.languageLabel}>{language === 'en' ? '中文' : 'EN'}</Text>
        ) : null}
      </Pressable>
    </View>
  );
}

/** 根据路由层级将当前页面映射到所属桌面导航区域。 */
function matchesDestination(pathname: string, id: (typeof destinations)[number]['id']): boolean {
  if (id === 'groups') return pathname === '/' || pathname.startsWith('/groups');
  if (id === 'knowledge') return pathname.startsWith('/knowledge');
  if (id === 'create')
    return pathname === '/create' || pathname === '/recording' || pathname === '/analysis-create';
  if (id === 'analysis') return pathname.startsWith('/sources') || pathname.startsWith('/analysis');
  return !['groups', 'knowledge', 'create', 'analysis'].some((sectionId) =>
    matchesDestination(pathname, sectionId as (typeof destinations)[number]['id']),
  );
}

const styles = StyleSheet.create({
  shell: {
    backgroundColor: colors.canvas,
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    position: 'relative',
  },
  desktopShell: { flexDirection: 'row' },
  sidebar: {
    backgroundColor: colors.card,
    borderRightColor: colors.divider,
    borderRightWidth: StyleSheet.hairlineWidth,
    flexShrink: 0,
    minHeight: 0,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xl,
    width: DESKTOP_NAVIGATION_WIDTH,
    zIndex: 2,
  },
  brand: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.xl,
    paddingHorizontal: spacing.sm,
  },
  brandMark: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radii.input,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  brandText: { color: textColors.primary, fontFamily: fontFamilies.sansBold, fontSize: 18 },
  navigationItems: { gap: spacing.xs, paddingBottom: spacing.xl },
  navigationItem: {
    alignItems: 'center',
    borderRadius: radii.input,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 46,
    paddingHorizontal: spacing.sm,
  },
  navigationItemSelected: { backgroundColor: colors.primarySurface },
  navigationItemPressed: { opacity: 0.72 },
  navigationLabel: {
    ...typography.body,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  navigationLabelSelected: { color: colors.primary, fontFamily: fontFamilies.sansBold },
  sidebarFooter: {
    ...typography.description,
    color: textColors.tertiary,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  contentColumn: { flex: 1, minHeight: 0, minWidth: 0 },
  page: { backgroundColor: colors.canvas, flex: 1, minHeight: 0, minWidth: 0 },
  desktopPage: { backgroundColor: 'transparent', overflow: 'hidden' },
  topBar: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderBottomColor: colors.divider,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'flex-end',
    minHeight: 68,
    paddingHorizontal: spacing.xl,
    zIndex: 2,
  },
  searchField: {
    alignItems: 'center',
    backgroundColor: colors.surfaceSecondary,
    borderColor: colors.borderSoft,
    borderRadius: radii.input,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    marginRight: 'auto',
    maxWidth: 520,
    minHeight: 42,
    paddingHorizontal: spacing.md,
    width: '55%',
  },
  searchFieldDisabled: { opacity: 0.62 },
  searchInput: {
    ...textInputText,
    ...typography.body,
    flex: 1,
    minWidth: 0,
    outlineStyle: 'none',
  } as never,
  languageButton: {
    alignItems: 'center',
    borderRadius: radii.input,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 40,
    minWidth: 72,
    paddingHorizontal: spacing.sm,
  },
  languageButtonCompact: { minWidth: 40 },
  languageLabel: { ...typography.body, color: textColors.secondary },
});
