/** Shared, accessible controls for the knowledge-library page hierarchy. */
import Ionicons from "@expo/vector-icons/Ionicons";
import { useRef } from "react";
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from "../../theme/tokens";
import type { DocumentFormat, KnowledgeDocument } from "./mockData";

export function showComingSoon(feature: string) {
  Alert.alert("功能建设中", `${feature}将在后续版本开放。`);
}

export function PageHeader({
  icon,
  onBack,
  title,
}: {
  icon?: DocumentFormat;
  onBack: () => void;
  title: string;
}) {
  return (
    <View style={styles.pageHeader}>
      <Pressable
        accessibilityLabel="返回"
        accessibilityRole="button"
        hitSlop={8}
        onPress={onBack}
        style={({ pressed }) => [
          styles.headerIconButton,
          pressed && styles.pressed,
        ]}
      >
        <Ionicons color={colors.ink} name="chevron-back" size={30} />
      </Pressable>
      <View style={styles.headerTitleRow}>
        {icon ? <DocumentFormatIcon format={icon} size={28} /> : null}
        <Text numberOfLines={1} style={styles.headerTitle}>
          {title}
        </Text>
      </View>
      <Pressable
        accessibilityLabel="更多操作"
        accessibilityRole="button"
        hitSlop={8}
        onPress={() => showComingSoon("更多操作")}
        style={({ pressed }) => [
          styles.headerIconButton,
          pressed && styles.pressed,
        ]}
      >
        <Ionicons color={colors.ink} name="ellipsis-horizontal" size={28} />
      </Pressable>
    </View>
  );
}

export function PageTabs<Tab extends string>({
  activeTab,
  onChange,
  tabs,
}: {
  activeTab: Tab;
  onChange: (tab: Tab) => void;
  tabs: readonly { key: Tab; label: string }[];
}) {
  return (
    <View accessibilityRole="tablist" style={styles.tabs}>
      {tabs.map((tab) => {
        const selected = activeTab === tab.key;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(tab.key)}
            style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
          >
            <Text style={[styles.tabText, selected && styles.activeTabText]}>
              {tab.label}
            </Text>
            <View style={[styles.tabLine, selected && styles.activeTabLine]} />
          </Pressable>
        );
      })}
    </View>
  );
}

export function SearchAndFilter({
  onChangeText,
  placeholder,
  value,
}: {
  onChangeText: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  const inputRef = useRef<TextInput>(null);

  return (
    <View style={styles.searchRow}>
      <Pressable
        onPress={() => inputRef.current?.focus()}
        style={styles.searchBox}
      >
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
          ref={inputRef}
          style={styles.searchInput}
          value={value}
        />
      </Pressable>
      <Pressable
        accessibilityLabel="筛选"
        accessibilityRole="button"
        onPress={() => showComingSoon("筛选")}
        style={({ pressed }) => [
          styles.filterButton,
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.filterText}>筛选</Text>
        <Ionicons
          color={colors.secondary}
          name="filter-outline"
          size={typography.heading5.lineHeight}
        />
      </Pressable>
    </View>
  );
}

export function ActionButton({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
    >
      <Ionicons
        color={colors.ink}
        name={icon}
        size={typography.body.lineHeight}
      />
      <Text style={styles.actionButtonText}>{label}</Text>
    </Pressable>
  );
}

export function DocumentFormatIcon({
  format,
  size = 36,
}: {
  format: DocumentFormat;
  size?: number;
}) {
  const config: Record<
    DocumentFormat,
    { color: string; icon: keyof typeof Ionicons.glyphMap }
  > = {
    markdown: { color: "#526071", icon: "document-text-outline" },
    word: { color: "#1768c4", icon: "document-outline" },
    spreadsheet: { color: "#078449", icon: "grid-outline" },
    text: { color: "#858f9f", icon: "reader-outline" },
  };

  return (
    <Ionicons
      accessibilityLabel={`${format} 文件`}
      color={config[format].color}
      name={config[format].icon}
      size={size}
    />
  );
}

export function DocumentStatusView({
  document,
}: {
  document: KnowledgeDocument;
}) {
  switch (document.status.kind) {
    case "complete":
      return (
        <Text style={styles.statusText}>{document.blocks.length} 个文本块</Text>
      );
    case "waiting":
      return (
        <View style={styles.inlineStatus}>
          <Ionicons
            color={colors.ink}
            name="hourglass-outline"
            size={typography.label.lineHeight}
          />
          <Text style={styles.statusText}>待解析</Text>
        </View>
      );
    case "uploading":
      return (
        <View style={styles.inlineStatus}>
          <Ionicons
            color={colors.ink}
            name="sync-outline"
            size={typography.label.lineHeight}
          />
          <Text style={styles.statusText}>上传中</Text>
        </View>
      );
    case "parsing":
      return (
        <Text style={styles.statusText}>
          解析中 ({document.status.progress}%)
        </Text>
      );
    case "failed":
      return (
        <View style={styles.failedStatus}>
          <Ionicons
            color="#ff5964"
            name="alert-circle-outline"
            size={typography.label.lineHeight}
          />
          <Text style={styles.statusText}>解析失败</Text>
        </View>
      );
  }
}

export function EmptyState({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <View accessibilityRole="alert" style={styles.emptyState}>
      <Ionicons color={colors.secondary} name="folder-open-outline" size={36} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyDescription}>{description}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: {
    backgroundColor: colors.background,
  },
  pageHeader: {
    alignItems: "center",
    borderBottomColor: colors.divider,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: 76,
    paddingHorizontal: spacing.sm,
  },
  headerIconButton: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  headerTitleRow: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  headerTitle: {
    ...typography.heading1,
    color: textColors.primary,
    flex: 1,
    fontFamily: fontFamilies.sansBold,
    fontWeight: "bold",
  },
  tabs: {
    flexDirection: "row",
    gap: spacing.lg,
    minHeight: 32,
    paddingHorizontal: spacing.md,
  },
  tab: {
    justifyContent: "flex-end",
  },
  tabText: {
    ...typography.heading5,
    color: textColors.secondary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: "bold",
    paddingBottom: spacing.xs,
  },
  activeTabText: {
    ...typography.heading4,
    color: textColors.primary,
  },
  tabLine: {
    backgroundColor: "transparent",
    height: 2,
  },
  activeTabLine: {
    backgroundColor: colors.ink,
  },
  searchRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  searchBox: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderRadius: radii.default,
    flex: 1,
    flexDirection: "row",
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
    textAlignVertical: "center",
  },
  filterButton: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
  },
  filterText: {
    ...typography.heading5,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  actionButton: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "center",
    minHeight: 56,
    paddingHorizontal: spacing.md,
  },
  actionButtonText: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: "bold",
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
  failedStatus: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderColor: "#ff5964",
    borderRadius: radii.default,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  emptyState: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  emptyTitle: {
    ...typography.heading2,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: "bold",
    marginTop: spacing.md,
  },
  emptyDescription: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    marginTop: spacing.sm,
    textAlign: "center",
  },
});
