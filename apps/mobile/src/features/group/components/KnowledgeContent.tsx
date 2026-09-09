/**
 * 分组知识库标签页内容。
 *
 * 根据上层提供的请求状态呈现知识库列表、错误与重试入口。
 *
 * Responsibilities:
 * - 只负责本标签页的内容渲染与局部交互。
 * - 由 GroupScreen 持有分页、导航和远端加载状态。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type { KnowledgeBaseSummary } from '@echowave/contracts';
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

export function KnowledgeContent({
  error,
  emptyMessage,
  knowledgeBases,
  loading,
  onOpenKnowledge,
  onOpenFilter,
  onRetry,
}: {
  error: string;
  emptyMessage: string;
  knowledgeBases: KnowledgeBaseSummary[];
  loading: boolean;
  onOpenKnowledge: (knowledgeId: string) => void;
  onOpenFilter: () => void;
  onRetry: () => void;
}) {
  const { formatDateTime, formatNumber, t } = useAppLanguage();
  if (loading) {
    return (
      <ActivityIndicator
        accessibilityLabel={t('groupContent.loadingKnowledge')}
        color={colors.ink}
      />
    );
  }
  if (error) {
    return (
      <View style={styles.card}>
        <Text accessibilityRole="alert" style={styles.description}>
          {error}
        </Text>
        <Pressable accessibilityRole="button" onPress={onRetry}>
          <Text style={styles.filterText}>{t('groupSettings.reload')}</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>
          {t('groupContent.totalKnowledge', { count: formatNumber(knowledgeBases.length) })}
        </Text>
        <Pressable
          accessibilityLabel={t('groupContent.sortKnowledge')}
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
      {knowledgeBases.length ? (
        knowledgeBases.map((knowledgeBase) => (
          <Pressable
            accessibilityLabel={t('knowledge.open', { name: knowledgeBase.name })}
            accessibilityRole="button"
            key={knowledgeBase.id}
            onPress={() => onOpenKnowledge(knowledgeBase.id)}
            style={({ pressed }) => [styles.card, pressed && styles.pressed]}
          >
            <View style={styles.titleRow}>
              <Ionicons
                color={colors.ink}
                name="file-tray-stacked-outline"
                size={typography.heading3.lineHeight}
              />
              <Text style={styles.cardTitle}>{knowledgeBase.name}</Text>
              <Ionicons color={colors.secondary} name="chevron-forward" size={20} />
            </View>
            <Text numberOfLines={2} style={styles.description}>
              {knowledgeBase.description}
            </Text>
            <Text style={styles.metaText}>
              {t('groupContent.documentCount', {
                count: formatNumber(knowledgeBase.documentCount),
              })}
            </Text>
            <Text style={styles.metaText}>
              {t('knowledge.updated', { date: formatDateTime(knowledgeBase.updatedAt) })}
            </Text>
          </Pressable>
        ))
      ) : (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>{emptyMessage}</Text>
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
  filterText: {
    ...typography.heading5,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  filterButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 40,
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
  cardTitle: {
    ...typography.heading2,
    color: textColors.primary,
    flex: 1,
    flexShrink: 1,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  metaText: {
    ...typography.label,
    color: textColors.tertiary,
    fontFamily: fontFamilies.sans,
  },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
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
