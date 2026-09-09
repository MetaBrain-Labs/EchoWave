/**
 * 知识库搜索与筛选控件。
 *
 * 组合可聚焦搜索输入与统一筛选入口，供知识库列表和文档页面复用。
 *
 * Responsibilities:
 * - 转发受控搜索值。
 * - 保持图标、焦点和筛选反馈一致。
 *
 * Notes:
 * - 过滤规则由调用页面负责。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { type RefObject, useRef } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';

import { showComingSoon } from './feedback';

/** 渲染知识库页面复用的搜索框与筛选入口。 */
export function SearchAndFilter({
  inputRef,
  onChangeText,
  placeholder,
  value,
}: {
  inputRef?: RefObject<TextInput | null>;
  onChangeText: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  const { t } = useAppLanguage();
  const localInputRef = useRef<TextInput>(null);
  const resolvedInputRef = inputRef ?? localInputRef;
  return (
    <View style={styles.searchRow}>
      <Pressable onPress={() => resolvedInputRef.current?.focus()} style={styles.searchBox}>
        <Ionicons
          color={colors.secondary}
          name="search-outline"
          size={typography.description.lineHeight}
        />
        <TextInput
          accessibilityLabel={placeholder}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={textColors.tertiary}
          ref={resolvedInputRef}
          style={styles.searchInput}
          value={value}
        />
      </Pressable>
      <Pressable
        accessibilityLabel={t('searchFilter.filter')}
        accessibilityRole="button"
        onPress={() => showComingSoon(t('searchFilter.filter'))}
        style={({ pressed }) => [styles.filterButton, pressed && styles.pressed]}
      >
        <Text style={styles.filterText}>{t('searchFilter.filter')}</Text>
        <Ionicons
          color={colors.secondary}
          name="filter-outline"
          size={typography.heading5.lineHeight}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { backgroundColor: colors.background },
  searchRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  searchBox: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radii.default,
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 40,
    paddingHorizontal: spacing.md,
  },
  searchInput: {
    ...typography.body,
    color: textColors.primary,
    flex: 1,
    fontFamily: fontFamilies.sans,
    height: typography.body.lineHeight,
    includeFontPadding: false,
    paddingVertical: 0,
    textAlignVertical: 'center',
  },
  filterButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
  },
  filterText: {
    ...typography.heading5,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
});
