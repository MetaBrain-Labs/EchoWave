/**
 * 知识库页面页头。
 *
 * 渲染知识库层级页面共用的返回、标题、格式图标和更多操作入口。
 *
 * Responsibilities:
 * - 提供一致且可访问的页面返回入口。
 * - 保持长标题和文档格式图标布局稳定。
 *
 * Notes:
 * - 页面导航行为由调用方注入。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type { DocumentFormat } from '@echowave/contracts';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontFamilies, spacing, textColors, typography } from '@/shared/theme/tokens';

import { DocumentFormatIcon } from './DocumentUi';
import { showComingSoon } from './feedback';

/** 渲染知识库层级页面使用的可访问返回页头。 */
export function PageHeader({ icon, moreLabel = '更多操作', onBack, onMore, title }: {
  icon?: DocumentFormat;
  moreLabel?: string;
  onBack: () => void;
  onMore?: () => void;
  title: string;
}) {
  return (
    <View style={styles.pageHeader}>
      <Pressable accessibilityLabel="返回" accessibilityRole="button" hitSlop={8} onPress={onBack}
        style={({ pressed }) => [styles.headerIconButton, pressed && styles.pressed]}>
        <Ionicons color={colors.ink} name="chevron-back" size={30} />
      </Pressable>
      <View style={styles.headerTitleRow}>
        {icon ? <DocumentFormatIcon format={icon} size={28} /> : null}
        <Text numberOfLines={1} style={styles.headerTitle}>{title}</Text>
      </View>
      <Pressable accessibilityLabel={moreLabel} accessibilityRole="button" hitSlop={8}
        onPress={onMore ?? (() => showComingSoon('更多操作'))}
        style={({ pressed }) => [styles.headerIconButton, pressed && styles.pressed]}>
        <Ionicons color={colors.ink} name="ellipsis-horizontal" size={28} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { backgroundColor: colors.background },
  pageHeader: {
    alignItems: 'center', borderBottomColor: colors.divider,
    borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', minHeight: 76,
    paddingHorizontal: spacing.sm,
  },
  headerIconButton: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
  headerTitleRow: {
    alignItems: 'center', flex: 1, flexDirection: 'row', gap: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  headerTitle: {
    ...typography.heading1, color: textColors.primary, flex: 1,
    fontFamily: fontFamilies.sansBold, fontWeight: 'bold',
  },
});
