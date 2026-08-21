/**
 * 分组工作区页面。
 *
 * 呈现分组内的音频、关联知识库和数据源三个区域，并协调标签、筛选、刷新与详情导航。
 *
 * Responsibilities:
 * - 渲染分组工作区及多种音频状态。
 * - 同步标签点击和横向滑动分页。
 *
 * Notes:
 * - 分组目录当前选择服务端返回的第一个分组，多分组切换入口仍为占位功能。
 */
import Ionicons from "@expo/vector-icons/Ionicons";
import type {
  AudioFileSummary,
  DataSourceSummary,
  GroupSummary,
  KnowledgeBaseSummary,
} from "@echowave/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import {
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
import { useSwipePager } from "@/shared/hooks/useSwipePager";
import {
  listGroupAudioFiles,
  listGroupDataSources,
  listGroupKnowledgeBases,
  listGroups,
} from "@/shared/api/workspaceApi";
import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from "@/shared/theme/tokens";
import { AudioContent } from "./components/AudioContent";
import { DataSourcesContent } from "./components/DataSourcesContent";
import { KnowledgeContent } from "./components/KnowledgeContent";

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

/** 渲染分组工作区并协调三个同级内容页的导航。 */
export function GroupScreen({
  onOpenAudio,
}: {
  onOpenAudio?: (id: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<TabKey>("audio");
  const [group, setGroup] = useState<GroupSummary>();
  const [audioItems, setAudioItems] = useState<AudioFileSummary[]>([]);
  const [audioLoading, setAudioLoading] = useState(true);
  const [audioError, setAudioError] = useState("");
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseSummary[]>([]);
  const [knowledgeLoading, setKnowledgeLoading] = useState(true);
  const [knowledgeError, setKnowledgeError] = useState("");
  const [dataSources, setDataSources] = useState<DataSourceSummary[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [sourcesError, setSourcesError] = useState("");
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
  const loadKnowledgeBases = useCallback(async (groupId: string) => {
    setKnowledgeLoading(true);
    setKnowledgeError("");
    try {
      const response = await listGroupKnowledgeBases(groupId);
      setKnowledgeBases(response.items);
    } catch (reason) {
      setKnowledgeError(reason instanceof Error ? reason.message : "关联知识库加载失败。");
    } finally {
      setKnowledgeLoading(false);
    }
  }, []);
  const loadAudio = useCallback(async (groupId: string) => {
    setAudioLoading(true);
    setAudioError("");
    try {
      setAudioItems((await listGroupAudioFiles(groupId)).items);
    } catch (reason) {
      setAudioError(reason instanceof Error ? reason.message : "分组音频加载失败。");
    } finally {
      setAudioLoading(false);
    }
  }, []);
  const loadSources = useCallback(async (groupId: string) => {
    setSourcesLoading(true);
    setSourcesError("");
    try {
      setDataSources((await listGroupDataSources(groupId)).items);
    } catch (reason) {
      setSourcesError(reason instanceof Error ? reason.message : "分组数据源加载失败。");
    } finally {
      setSourcesLoading(false);
    }
  }, []);
  useEffect(() => {
    const task = setTimeout(() => {
      void listGroups()
        .then((response) => {
          const firstGroup = response.items[0];
          setGroup(firstGroup);
          if (!firstGroup) {
            setAudioLoading(false);
            setKnowledgeLoading(false);
            setSourcesLoading(false);
            return;
          }
          void Promise.all([
            loadAudio(firstGroup.id),
            loadKnowledgeBases(firstGroup.id),
            loadSources(firstGroup.id),
          ]);
        })
        .catch((reason) => {
          const message = reason instanceof Error ? reason.message : "分组加载失败。";
          setAudioError(message);
          setKnowledgeError(message);
          setSourcesError(message);
          setAudioLoading(false);
          setKnowledgeLoading(false);
          setSourcesLoading(false);
        });
    }, 0);
    return () => clearTimeout(task);
  }, [loadAudio, loadKnowledgeBases, loadSources]);
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
              {group?.name ?? "分组"}
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
          {group?.name ?? "分组"}
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
            <AudioContent
              error={audioError}
              items={audioItems}
              loading={audioLoading}
              onOpenAudio={onOpenAudio}
              onRetry={() => { if (group) void loadAudio(group.id); }}
            />
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
            <KnowledgeContent
              error={knowledgeError}
              knowledgeBases={knowledgeBases}
              loading={knowledgeLoading}
              onRetry={() => { if (group) void loadKnowledgeBases(group.id); }}
            />
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
            <DataSourcesContent
              error={sourcesError}
              loading={sourcesLoading}
              onRetry={() => { if (group) void loadSources(group.id); }}
              sources={dataSources}
            />
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
});
