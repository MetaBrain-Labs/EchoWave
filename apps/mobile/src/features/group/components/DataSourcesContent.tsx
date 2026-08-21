/**
 * 分组数据源标签页内容。
 *
 * 呈现当前分组的服务端数据源及连接状态。
 *
 * Responsibilities:
 * - 只负责本标签页的内容渲染与局部交互。
 * - 由 GroupScreen 持有分页、导航和远端加载状态。
 */
import Ionicons from "@expo/vector-icons/Ionicons";
import type { DataSourceSummary } from "@echowave/contracts";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from "@/shared/theme/tokens";
export function DataSourcesContent({
  error,
  loading,
  onRetry,
  sources,
}: {
  error: string;
  loading: boolean;
  onRetry: () => void;
  sources: DataSourceSummary[];
}) {
  if (loading) {
    return <ActivityIndicator accessibilityLabel="正在加载分组数据源" color={colors.ink} />;
  }
  if (error) {
    return (
      <View style={styles.card}>
        <Text accessibilityRole="alert" style={styles.description}>{error}</Text>
        <Pressable accessibilityRole="button" onPress={onRetry}>
          <Text style={styles.metaText}>重新加载</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <>
      <Text style={[styles.sectionTitle, styles.sectionHeaderSolo]}>
        共连接 {sources.length} 个数据源
      </Text>
      {sources.map((source) => (
        <View key={source.id} style={styles.card}>
          <View style={styles.sourceTitleRow}>
            <View style={styles.titleRow}>
              <Ionicons
                color={colors.ink}
                name="git-network-outline"
                size={typography.heading3.lineHeight}
              />
              <Text style={styles.cardTitle}>{source.name}</Text>
            </View>
            <View style={styles.connectedBadge}>
              <Text style={styles.connectedText}>已连接</Text>
            </View>
          </View>
          <Text numberOfLines={2} style={styles.description}>
            {source.description}
          </Text>
          <Text style={styles.metaText}>{source.connectionLabel}</Text>
          <Text style={styles.metaText}>最近上传 {source.lastUploadedAt ? new Date(source.lastUploadedAt).toLocaleString() : '暂无'}</Text>
        </View>
      ))}
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
    fontWeight: "bold",
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
  cardTitle: {
    ...typography.heading2,
    color: textColors.primary,
    flexShrink: 1,
    fontFamily: fontFamilies.sansBold,
    fontWeight: "bold",
  },
  metaText: {
    ...typography.label,
    color: textColors.tertiary,
    fontFamily: fontFamilies.sans,
  },
  titleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  sourceTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
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
    fontWeight: "bold",
  },
  description: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
});
