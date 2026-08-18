/** Implements the sketch-inspired group workspace and its three content tabs. */
import Ionicons from "@expo/vector-icons/Ionicons";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useSwipePager } from "../../components/useSwipePager";
import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from "../../theme/tokens";
import {
  audioItems,
  dataSources,
  type AudioItem,
} from "./mockData";
import { knowledgeBases } from "../knowledge/mockData";

const tabs = [
  { key: "audio", label: "音频分析" },
  { key: "knowledge", label: "关联知识库" },
  { key: "sources", label: "连接数据源" },
] as const;

type TabKey = (typeof tabs)[number]["key"];
const tabKeys = tabs.map((tab) => tab.key);
const headerCollapseGuardMs = 250;

function showComingSoon(feature: string) {
  Alert.alert("功能建设中", `${feature}将在后续版本开放。`);
}

function IconButton({
  icon,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={10}
      onPress={() => showComingSoon(label)}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
    >
      <Ionicons color={colors.ink} name={icon} size={29} />
    </Pressable>
  );
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

function AudioContent({
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

function KnowledgeContent() {
  return (
    <>
      <Text style={[styles.sectionTitle, styles.sectionHeaderSolo]}>
        共关联 {knowledgeBases.length} 个知识库
      </Text>
      {knowledgeBases.map((knowledgeBase) => (
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
          <Text style={styles.metaText}>
            共 {knowledgeBase.documentCount} 份文档
          </Text>
          <Text style={styles.metaText}>更新于 {knowledgeBase.updatedAt}</Text>
        </View>
      ))}
    </>
  );
}

function SourcesContent() {
  return (
    <>
      <Text style={[styles.sectionTitle, styles.sectionHeaderSolo]}>
        共连接 {dataSources.length} 个数据源
      </Text>
      {dataSources.map((source) => (
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
          <Text style={styles.metaText}>{source.connection}</Text>
          <Text style={styles.metaText}>最近上传 {source.uploadedAt}</Text>
        </View>
      ))}
    </>
  );
}

export function GroupScreen({
  onOpenAudio,
}: {
  onOpenAudio?: (id: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<TabKey>("audio");
  const [collapsedTabs, setCollapsedTabs] = useState<Record<TabKey, boolean>>({
    audio: false,
    knowledge: false,
    sources: false,
  });
  const collapsedAt = useRef<Record<TabKey, number>>({
    audio: 0,
    knowledge: 0,
    sources: 0,
  });
  const headerCollapsed = collapsedTabs[activeTab];
  const { handleMomentumScrollEnd, pageWidth, pagerRef, selectTab } =
    useSwipePager({
      activeTab,
      onTabChange: setActiveTab,
      tabs: tabKeys,
    });
  const handleContentScroll =
    (tab: TabKey) =>
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (event.nativeEvent.contentOffset.y <= spacing.xl) {
        return;
      }
      setCollapsedTabs((current) => {
        if (current[tab]) {
          return current;
        }
        collapsedAt.current[tab] = Date.now();
        return { ...current, [tab]: true };
      });
    };
  const handleScrollEnd =
    (tab: TabKey) =>
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (event.nativeEvent.contentOffset.y <= 0) {
        setCollapsedTabs((current) =>
          current[tab] && Date.now() - collapsedAt.current[tab] >= headerCollapseGuardMs
            ? { ...current, [tab]: false }
            : current,
        );
      }
    };

  return (
    <SafeAreaView edges={["top"]} style={styles.safeArea}>
      <View style={styles.topBar}>
        <View style={styles.topLeft}>
          <IconButton icon="menu" label="菜单" />
          {headerCollapsed ? (
            <Text testID="group-inline-title" style={styles.inlineTitle}>
              分组名称
            </Text>
          ) : null}
        </View>
        {!headerCollapsed ? (
          <View style={styles.topActions}>
            <IconButton icon="search" label="搜索" />
            <IconButton icon="options-outline" label="设置筛选" />
          </View>
        ) : null}
      </View>
      {!headerCollapsed ? (
        <Text testID="group-display-title" style={styles.displayTitle}>
          分组名称
        </Text>
      ) : null}
      <View accessibilityRole="tablist" style={styles.tabs}>
        {tabs.map((tab) => {
          const active = tab.key === activeTab;
          return (
            <Pressable
              key={tab.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => selectTab(tab.key)}
              style={styles.tab}
            >
              <Text style={[styles.tabText, active && styles.activeTabText]}>
                {tab.label}
              </Text>
              <View
                style={[
                  styles.tabUnderline,
                  active && styles.activeTabUnderline,
                ]}
              />
            </Pressable>
          );
        })}
      </View>
      <ScrollView
        accessibilityLabel="分组内容分页"
        directionalLockEnabled
        horizontal
        nestedScrollEnabled
        onMomentumScrollEnd={handleMomentumScrollEnd}
        pagingEnabled
        ref={pagerRef}
        showsHorizontalScrollIndicator={false}
        style={styles.pager}
        testID="group-tab-pager"
      >
        <View style={[styles.page, { width: pageWidth }]}>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            onMomentumScrollEnd={handleScrollEnd("audio")}
            onScroll={handleContentScroll("audio")}
            onScrollEndDrag={handleScrollEnd("audio")}
            scrollEventThrottle={16}
            showsVerticalScrollIndicator={false}
            testID="group-audio-scroll"
          >
            <AudioContent onOpenAudio={onOpenAudio} />
          </ScrollView>
        </View>
        <View style={[styles.page, { width: pageWidth }]}>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            onMomentumScrollEnd={handleScrollEnd("knowledge")}
            onScroll={handleContentScroll("knowledge")}
            onScrollEndDrag={handleScrollEnd("knowledge")}
            scrollEventThrottle={16}
            showsVerticalScrollIndicator={false}
            testID="group-knowledge-scroll"
          >
            <KnowledgeContent />
          </ScrollView>
        </View>
        <View style={[styles.page, { width: pageWidth }]}>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            onMomentumScrollEnd={handleScrollEnd("sources")}
            onScroll={handleContentScroll("sources")}
            onScrollEndDrag={handleScrollEnd("sources")}
            scrollEventThrottle={16}
            showsVerticalScrollIndicator={false}
            testID="group-sources-scroll"
          >
            <SourcesContent />
          </ScrollView>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.canvas,
    flex: 1,
  },
  topBar: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  topActions: {
    flexDirection: "row",
    gap: spacing.md,
  },
  topLeft: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  inlineTitle: {
    ...typography.heading2,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: "bold",
  },
  iconButton: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  pressed: {
    backgroundColor: colors.background,
    borderRadius: radii.default,
  },
  displayTitle: {
    ...typography.groupName,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: "bold",
    marginBottom: spacing.xl,
    marginHorizontal: spacing.md,
    marginTop: spacing.xxl,
  },
  tabs: {
    borderBottomColor: colors.divider,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
  },
  tab: {
    alignItems: "center",
    flex: 1,
    minHeight: 51,
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
  tabUnderline: {
    backgroundColor: "transparent",
    height: 2,
    width: "68%",
  },
  activeTabUnderline: {
    backgroundColor: colors.ink,
  },
  pager: {
    flex: 1,
  },
  page: {
    height: "100%",
  },
  scrollContent: {
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
  },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.lg,
  },
  sectionHeaderSolo: {
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
