/**
 * 分组音频标签页内容。
 *
 * 呈现音频列表及完成、等待、上传、分析中的状态。
 *
 * Responsibilities:
 * - 只负责本标签页的内容渲染与局部交互。
 * - 由 GroupScreen 持有分页、导航和远端加载状态。
 */
import Ionicons from "@expo/vector-icons/Ionicons";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";

import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from "@/shared/theme/tokens";
import { audioItems, type AudioItem } from "../mockData";

function showComingSoon(feature: string) {
  Alert.alert("功能建设中", `${feature}将在后续版本开放。`);
}

function AudioStatusView({ status }: Pick<AudioItem, "status">) {
  switch (status.kind) {
    case "complete":
      return <Text style={styles.statusText}>{status.duration}</Text>;
    case "waiting":
      return (
        <View style={styles.inlineStatus}>
          <Ionicons
            color={colors.ink}
            name="hourglass-outline"
            size={typography.label.lineHeight}
          />
          <Text style={styles.statusText}>待分析</Text>
        </View>
      );
    case "uploading":
      return (
        <View style={styles.inlineStatus}>
          <ActivityIndicator
            color={colors.ink}
            size={typography.label.lineHeight}
          />
          <Text style={styles.statusText}>上传中</Text>
        </View>
      );
    case "analyzing":
      return <Text style={styles.statusText}>分析中 ({status.progress}%)</Text>;
  }
}

function AudioCard({
  item,
  onOpenAudio,
}: {
  item: AudioItem;
  onOpenAudio?: (id: string) => void;
}) {
  const content = (
    <>
      <Text style={styles.cardTitle}>{item.title}</Text>
      <View style={styles.audioMetaRow}>
        <Text style={styles.metaText}>时间 {item.createdAt}</Text>
        <AudioStatusView status={item.status} />
      </View>
      {item.sharedFrom ? (
        <View style={styles.sharedRow}>
          <Ionicons
            color={colors.muted}
            name="swap-horizontal"
            size={typography.label.lineHeight}
          />
          <Text style={styles.metaText}>来自 {item.sharedFrom}</Text>
        </View>
      ) : null}
    </>
  );

  if (item.status.kind !== "complete") {
    return <View style={styles.card}>{content}</View>;
  }

  return (
    <Pressable
      accessibilityHint="打开该音频的分析详情"
      accessibilityLabel={`${item.title}，分析已完成`}
      accessibilityRole="button"
      onPress={() => onOpenAudio?.(item.id)}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

export function AudioContent({
  onOpenAudio,
}: {
  onOpenAudio?: (id: string) => void;
}) {
  return (
    <>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>共 {audioItems.length} 份音频</Text>
        <Pressable
          accessibilityLabel="排序筛选"
          accessibilityRole="button"
          onPress={() => showComingSoon("排序筛选")}
          style={({ pressed }) => [
            styles.filterButton,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.filterText}>排序筛选</Text>
          <Ionicons
            color={colors.secondary}
            name="filter-outline"
            size={typography.heading5.lineHeight}
          />
        </Pressable>
      </View>
      {audioItems.map((item) => (
        <AudioCard key={item.id} item={item} onOpenAudio={onOpenAudio} />
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  pressed: {
    backgroundColor: colors.background,
    borderRadius: radii.default,
  },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    ...typography.heading2,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: "bold",
  },
  filterButton: {
    alignItems: "center",
    flexDirection: "row",
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
  audioMetaRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.md,
  },
  metaText: {
    ...typography.label,
    color: textColors.tertiary,
    fontFamily: fontFamilies.sans,
  },
  statusText: {
    ...typography.label,
    color: textColors.primary,
    fontFamily: fontFamilies.sans,
  },
  inlineStatus: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
  },
  sharedRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
});

