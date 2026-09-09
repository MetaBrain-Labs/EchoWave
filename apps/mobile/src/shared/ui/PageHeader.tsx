/**
 * 通用详情页页头。
 *
 * 渲染详情层级页面共用的返回、标题、前置内容、搜索和更多操作入口。
 *
 * Responsibilities:
 * - 提供一致且可访问的页面返回与操作按钮。
 * - 保持长标题和可选前置内容的布局稳定。
 *
 * Notes:
 * - 页面导航和业务反馈行为均由调用方注入。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontFamilies, spacing, textColors, typography } from '@/shared/theme/tokens';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';

/** 渲染详情层级页面使用的可访问返回页头。 */
export function PageHeader({
  leading,
  moreLabel,
  onBack,
  onMore,
  onSearch,
  searchLabel,
  title,
}: {
  leading?: ReactNode;
  moreLabel?: string;
  onBack: () => void;
  onMore: () => void;
  onSearch?: () => void;
  searchLabel?: string;
  title: string;
}) {
  const { t } = useAppLanguage();
  return (
    <View style={styles.pageHeader}>
      <Pressable
        accessibilityLabel={t('common.back')}
        accessibilityRole="button"
        hitSlop={8}
        onPress={onBack}
        style={({ pressed }) => [styles.headerIconButton, pressed && styles.pressed]}
      >
        <Ionicons color={colors.ink} name="chevron-back" size={30} />
      </Pressable>
      <View style={styles.headerTitleRow}>
        {leading}
        <Text numberOfLines={1} style={styles.headerTitle}>
          {title}
        </Text>
      </View>
      <View style={styles.headerActions}>
        {onSearch ? (
          <Pressable
            accessibilityLabel={searchLabel ?? t('common.search')}
            accessibilityRole="button"
            hitSlop={8}
            onPress={onSearch}
            style={({ pressed }) => [styles.headerIconButton, pressed && styles.pressed]}
          >
            <Ionicons color={colors.ink} name="search-outline" size={28} />
          </Pressable>
        ) : null}
        <Pressable
          accessibilityLabel={moreLabel ?? t('common.moreActions')}
          accessibilityRole="button"
          hitSlop={8}
          onPress={onMore}
          style={({ pressed }) => [styles.headerIconButton, pressed && styles.pressed]}
        >
          <Ionicons color={colors.ink} name="ellipsis-horizontal" size={28} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { backgroundColor: colors.background },
  pageHeader: {
    alignItems: 'center',
    borderBottomColor: colors.divider,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 76,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.background,
  },
  headerIconButton: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  headerActions: { alignItems: 'center', flexDirection: 'row' },
  headerTitleRow: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  headerTitle: {
    ...typography.heading1,
    color: textColors.primary,
    flex: 1,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
});
