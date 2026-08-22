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

export function KnowledgeContent({
  error,
  emptyMessage,
  knowledgeBases,
  loading,
  onRetry,
}: {
  error: string;
  emptyMessage: string;
  knowledgeBases: KnowledgeBaseSummary[];
  loading: boolean;
  onRetry: () => void;
}) {
  if (loading) {
    return <ActivityIndicator accessibilityLabel="正在加载关联知识库" color={colors.ink} />;
  }
  if (error) {
    return (
      <View style={styles.card}>
        <Text accessibilityRole="alert" style={styles.description}>
          {error}
        </Text>
        <Pressable accessibilityRole="button" onPress={onRetry}>
          <Text style={styles.filterText}>重新加载</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <>
      <Text style={[styles.sectionTitle, styles.sectionHeaderSolo]}>
        共关联 {knowledgeBases.length} 个知识库
      </Text>
      {knowledgeBases.length ? (
        knowledgeBases.map((knowledgeBase) => (
          <View key={knowledgeBase.id} style={styles.card}>
            <View style={styles.titleRow}>
              <Ionicons
                color={colors.ink}
                name="file-tray-stacked-outline"
                size={typography.heading3.lineHeight}
              />
              <Text style={styles.cardTitle}>{knowledgeBase.name}</Text>
            </View>
            <Text numberOfLines={2} style={styles.description}>
              {knowledgeBase.description}
            </Text>
            <Text style={styles.metaText}>共 {knowledgeBase.documentCount} 份文档</Text>
            <Text style={styles.metaText}>
              更新于 {new Date(knowledgeBase.updatedAt).toLocaleDateString()}
            </Text>
          </View>
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
  sectionHeaderSolo: {
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
  card: {
    backgroundColor: colors.card,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.base,
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.035,
    shadowRadius: 5,
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
});
