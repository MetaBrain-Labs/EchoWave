/**
 * 知识库收集目录卡片。
 *
 * Responsibilities:
 * - 展示规则名称、正式案例数量及更新时间。
 * - 主体与省略号使用独立触控区域。
 * Notes:
 * - 只展示目录，不触发解析。
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { CollectionFolder } from '@echowave/contracts';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import { colors, fontFamilies, spacing, textColors, typography } from '@/shared/theme/tokens';

/** 规则文件夹与普通文档使用一致的列表密度。 */
export function CollectionFolderRow({
  folder,
  onOpen,
  onMore,
}: {
  folder: CollectionFolder;
  onOpen: () => void;
  onMore: () => void;
}) {
  const { t, formatDateTime } = useAppLanguage();
  const name =
    folder.kind === 'rule'
      ? folder.name
      : t(folder.kind === 'legacy' ? 'collection.legacyFolder' : 'collection.manualFolder');
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('collection.openFolder', { name })}
        onPress={onOpen}
        style={styles.open}
      >
        <Ionicons name="folder-outline" size={40} color={textColors.secondary} />
        <View style={styles.copy}>
          <Text style={styles.title} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.meta}>
            {t('collection.folderCount', { count: folder.caseCount })}
          </Text>
          <Text style={styles.updated}>
            {t('knowledge.updated', { date: formatDateTime(folder.updatedAt) })}
          </Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('collection.folderActions', { name })}
        onPress={onMore}
        style={styles.more}
      >
        <Ionicons name="ellipsis-vertical" size={24} color={textColors.primary} />
      </Pressable>
    </View>
  );
}
const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
    paddingVertical: spacing.md,
  },
  open: { flex: 1, flexDirection: 'row', gap: spacing.md, alignItems: 'center', minHeight: 44 },
  copy: { flex: 1, gap: spacing.xs },
  title: {
    ...typography.heading3,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
    color: textColors.primary,
  },
  meta: { ...typography.description, fontFamily: fontFamilies.sans, color: textColors.secondary },
  updated: { ...typography.description, fontFamily: fontFamilies.sans, color: textColors.tertiary },
  more: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
});
