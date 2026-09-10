/**
 * 分组数据源标签页内容。
 *
 * 呈现当前分组的服务端数据源及连接状态。
 *
 * Responsibilities:
 * - 只负责本标签页的内容渲染与局部交互。
 * - 由 GroupScreen 持有分页、导航和远端加载状态。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type { DataSourceSummary } from '@echowave/contracts';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
export function DataSourcesContent({
  error,
  emptyMessage,
  loading,
  onOpenFilter,
  onOpenSource,
  onLink,
  onRetry,
  showLinkAction,
  sources,
}: {
  error: string;
  emptyMessage: string;
  loading: boolean;
  onLink?: () => void;
  onOpenFilter: () => void;
  onOpenSource: (sourceId: string) => void;
  onRetry: () => void;
  showLinkAction?: boolean;
  sources: DataSourceSummary[];
}) {
  const { formatDateTime, formatNumber, t } = useAppLanguage();
  if (loading) {
    return (
      <ActivityIndicator accessibilityLabel={t('groupContent.loadingSources')} color={colors.ink} />
    );
  }
  if (error) {
    return (
      <View style={styles.card}>
        <Text accessibilityRole="alert" style={styles.description}>
          {error}
        </Text>
        <Pressable accessibilityRole="button" onPress={onRetry}>
          <Text style={styles.metaText}>{t('groupSettings.reload')}</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>
          {t('groupContent.totalSources', { count: formatNumber(sources.length) })}
        </Text>
        <Pressable
          accessibilityLabel={t('groupContent.sortSources')}
          accessibilityRole="button"
          onPress={onOpenFilter}
          style={({ pressed }) => [styles.filterButton, pressed && styles.pressed]}
        >
          <Text style={styles.filterText}>{t('groupContent.sort')}</Text>
          <Ionicons
            color={colors.secondary}
            name="filter-outline"
            size={typography.heading5.lineHeight}
          />
        </Pressable>
      </View>
      {sources.length ? (
        sources.map((source) => (
          <Pressable
            accessibilityLabel={t('sources.open', { name: source.name })}
            accessibilityRole="button"
            key={source.id}
            onPress={() => onOpenSource(source.id)}
            style={({ pressed }) => [styles.card, pressed && styles.pressed]}
          >
            <View style={styles.sourceTitleRow}>
              <View style={styles.titleRow}>
                <Ionicons
                  color={colors.ink}
                  name="git-network-outline"
                  size={typography.heading3.lineHeight}
                />
                <Text style={styles.cardTitle}>{source.name}</Text>
              </View>
              <View style={styles.cardActions}>
                <View style={styles.connectedBadge}>
                  <Text style={styles.connectedText}>{t('sources.connected')}</Text>
                </View>
                <Ionicons color={colors.secondary} name="chevron-forward" size={20} />
              </View>
            </View>
            <Text numberOfLines={2} style={styles.description}>
              {source.description}
            </Text>
            <Text style={styles.metaText}>{source.connectionLabel}</Text>
            <Text style={styles.metaText}>
              {t('sources.lastUpload', {
                date: source.lastUploadedAt
                  ? formatDateTime(source.lastUploadedAt)
                  : t('sources.none'),
              })}
            </Text>
          </Pressable>
        ))
      ) : (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>{emptyMessage}</Text>
          {showLinkAction && onLink ? (
            <Pressable
              accessibilityLabel={t('groupSettings.linkSources')}
              accessibilityRole="button"
              onPress={onLink}
              style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}
            >
              <Text style={styles.linkButtonText}>{t('groupSettings.linkSources')}</Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    ...typography.heading2,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  filterButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 40,
  },
  filterText: {
    ...typography.heading5,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: spacing.sm,
    padding: spacing.md,
  },
  emptyState: {
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xl,
  },
  emptyText: {
    ...typography.body,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    textAlign: 'center',
  },
  linkButton: {
    alignItems: 'center',
    backgroundColor: colors.ink,
    borderRadius: radii.default,
    justifyContent: 'center',
    marginTop: spacing.md,
    minHeight: 48,
    paddingHorizontal: spacing.lg,
  },
  linkButtonText: {
    ...typography.body,
    color: colors.white,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  cardTitle: {
    ...typography.heading2,
    color: textColors.primary,
    flexShrink: 1,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  cardActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  metaText: {
    ...typography.label,
    color: textColors.tertiary,
    fontFamily: fontFamilies.sans,
  },
  titleRow: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  sourceTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  connectedBadge: {
    backgroundColor: colors.successSurface,
    borderRadius: radii.round,
    marginLeft: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  connectedText: {
    ...typography.label,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  description: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  pressed: {
    opacity: 0.65,
  },
});
