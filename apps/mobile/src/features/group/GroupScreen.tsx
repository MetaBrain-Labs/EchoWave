/**
 * 分组工作区页面。
 *
 * 呈现当前分组的音频、关联知识库和数据源，并协调分组生命周期、跨标签搜索、
 * 音频排序筛选以及横向分页。
 *
 * Responsibilities:
 * - 加载、创建、切换和软归档租户内分组。
 * - 组合三个标签的数据查询、加载与失败状态。
 * - 防止快速切组时过期响应覆盖当前分组。
 *
 * Notes:
 * - 分组选择、搜索和筛选只保存在当前页面会话。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type {
  AudioFileSummary,
  DataSourceSummary,
  GroupSummary,
  KnowledgeBaseSummary,
} from '@echowave/contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  createGroup,
  listGroupAudioFiles,
  listGroupDataSources,
  listGroupKnowledgeBases,
  listGroups,
} from '@/shared/api/groupsApi';
import { useSwipePager } from '@/shared/hooks/useSwipePager';
import { useInitialRequestLoading } from '@/shared/navigation/NavigationLoadingProvider';
import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';
import { PageTabs } from '@/shared/ui/PageTabs';
import { SearchSheet } from '@/shared/ui/SearchSheet';
import { AudioContent } from './components/AudioContent';
import { DataSourcesContent } from './components/DataSourcesContent';
import { GroupDrawer } from './components/GroupDrawer';
import { GroupFilterSheet } from './components/GroupFilterSheet';
import { KnowledgeContent } from './components/KnowledgeContent';
import {
  selectAudioItems,
  selectDataSources,
  selectKnowledgeBases,
  type AudioSortOrder,
  type AudioStatusKind,
  type DataSourceLocationKind,
  type DataSourceStatusKind,
  type KnowledgeDocumentFilter,
  type ResourceSortOrder,
} from './model';

const tabs = [
  { key: 'audio', label: '音频分析' },
  { key: 'knowledge', label: '关联知识库' },
  { key: 'sources', label: '连接数据源' },
] as const;

export type TabKey = (typeof tabs)[number]['key'];
const tabKeys = tabs.map((tab) => tab.key);
const headerCollapseGuardMs = 250;

function IconButton({
  disabled = false,
  icon,
  label,
  onPress,
}: {
  disabled?: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      disabled={disabled}
      hitSlop={10}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Ionicons color={colors.ink} name={icon} size={29} />
    </Pressable>
  );
}

/** 渲染分组工作区并协调分组目录与三个同级内容页。 */
export function GroupScreen({
  initialGroupId,
  initialTab,
  onOpenAudio,
  onOpenKnowledge,
  onOpenSource,
  onOpenSettings,
  onGroupChange,
  onTabChange,
}: {
  initialGroupId?: string;
  initialTab?: TabKey;
  onOpenAudio?: (id: string, groupId: string) => void;
  onOpenKnowledge?: (id: string, groupId: string) => void;
  onOpenSource?: (id: string, groupId: string) => void;
  onOpenSettings?: (id: string) => void;
  onGroupChange?: (groupId?: string) => void;
  onTabChange?: (tab: TabKey) => void;
}) {
  const runInitialRequest = useInitialRequestLoading();
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab ?? 'audio');
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [group, setGroup] = useState<GroupSummary>();
  const [directoryLoading, setDirectoryLoading] = useState(true);
  const [directoryError, setDirectoryError] = useState('');
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterVisible, setFilterVisible] = useState(false);
  const [audioSortOrder, setAudioSortOrder] = useState<AudioSortOrder>('newest');
  const [audioStatuses, setAudioStatuses] = useState<Set<AudioStatusKind>>(() => new Set());
  const [knowledgeSortOrder, setKnowledgeSortOrder] = useState<ResourceSortOrder>('newest');
  const [knowledgeDocumentFilter, setKnowledgeDocumentFilter] =
    useState<KnowledgeDocumentFilter>('all');
  const [sourceSortOrder, setSourceSortOrder] = useState<ResourceSortOrder>('newest');
  const [sourceLocations, setSourceLocations] = useState<Set<DataSourceLocationKind>>(
    () => new Set(),
  );
  const [sourceStatuses, setSourceStatuses] = useState<Set<DataSourceStatusKind>>(() => new Set());
  const [audioItems, setAudioItems] = useState<AudioFileSummary[]>([]);
  const [audioLoading, setAudioLoading] = useState(true);
  const [audioError, setAudioError] = useState('');
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseSummary[]>([]);
  const [knowledgeLoading, setKnowledgeLoading] = useState(true);
  const [knowledgeError, setKnowledgeError] = useState('');
  const [dataSources, setDataSources] = useState<DataSourceSummary[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [sourcesError, setSourcesError] = useState('');
  const [collapsedTabs, setCollapsedTabs] = useState<Record<TabKey, boolean>>({
    audio: false,
    knowledge: false,
    sources: false,
  });
  const selectedGroupId = useRef<string | undefined>(undefined);
  const requestedGroupId = useRef(initialGroupId);
  const previousRoutedGroupId = useRef(initialGroupId);
  const previousRoutedTab = useRef(initialTab);
  const onGroupChangeRef = useRef(onGroupChange);
  const onTabChangeRef = useRef(onTabChange);
  const collapsedAt = useRef<Record<TabKey, number>>({
    audio: 0,
    knowledge: 0,
    sources: 0,
  });

  const headerCollapsed = Boolean(group) && collapsedTabs[activeTab];

  useEffect(() => {
    requestedGroupId.current = initialGroupId;
    onGroupChangeRef.current = onGroupChange;
    onTabChangeRef.current = onTabChange;
  }, [initialGroupId, onGroupChange, onTabChange]);

  const loadKnowledgeBases = useCallback(async (groupId: string) => {
    setKnowledgeLoading(true);
    setKnowledgeError('');
    try {
      const response = await listGroupKnowledgeBases(groupId);
      if (selectedGroupId.current === groupId) setKnowledgeBases(response.items);
    } catch (reason) {
      if (selectedGroupId.current === groupId) {
        setKnowledgeError(reason instanceof Error ? reason.message : '关联知识库加载失败。');
      }
    } finally {
      if (selectedGroupId.current === groupId) setKnowledgeLoading(false);
    }
  }, []);

  const loadAudio = useCallback(async (groupId: string) => {
    setAudioLoading(true);
    setAudioError('');
    try {
      const response = await listGroupAudioFiles(groupId);
      if (selectedGroupId.current === groupId) setAudioItems(response.items);
    } catch (reason) {
      if (selectedGroupId.current === groupId) {
        setAudioError(reason instanceof Error ? reason.message : '分组音频加载失败。');
      }
    } finally {
      if (selectedGroupId.current === groupId) setAudioLoading(false);
    }
  }, []);

  const loadSources = useCallback(async (groupId: string) => {
    setSourcesLoading(true);
    setSourcesError('');
    try {
      const response = await listGroupDataSources(groupId);
      if (selectedGroupId.current === groupId) setDataSources(response.items);
    } catch (reason) {
      if (selectedGroupId.current === groupId) {
        setSourcesError(reason instanceof Error ? reason.message : '分组数据源加载失败。');
      }
    } finally {
      if (selectedGroupId.current === groupId) setSourcesLoading(false);
    }
  }, []);

  const clearSelection = useCallback(() => {
    selectedGroupId.current = undefined;
    setGroup(undefined);
    setSearchQuery('');
    setAudioSortOrder('newest');
    setAudioStatuses(new Set());
    setKnowledgeSortOrder('newest');
    setKnowledgeDocumentFilter('all');
    setSourceSortOrder('newest');
    setSourceLocations(new Set());
    setSourceStatuses(new Set());
    setAudioItems([]);
    setKnowledgeBases([]);
    setDataSources([]);
    setAudioError('');
    setKnowledgeError('');
    setSourcesError('');
    setAudioLoading(false);
    setKnowledgeLoading(false);
    setSourcesLoading(false);
    setCollapsedTabs({ audio: false, knowledge: false, sources: false });
  }, []);

  const selectGroup = useCallback(
    async (nextGroup: GroupSummary, syncRoute = false) => {
      if (selectedGroupId.current === nextGroup.id) {
        setGroup(nextGroup);
        if (syncRoute) onGroupChangeRef.current?.(nextGroup.id);
        return;
      }
      selectedGroupId.current = nextGroup.id;
      setGroup(nextGroup);
      if (syncRoute) onGroupChangeRef.current?.(nextGroup.id);
      setSearchQuery('');
      setAudioSortOrder('newest');
      setAudioStatuses(new Set());
      setKnowledgeSortOrder('newest');
      setKnowledgeDocumentFilter('all');
      setSourceSortOrder('newest');
      setSourceLocations(new Set());
      setSourceStatuses(new Set());
      setAudioItems([]);
      setKnowledgeBases([]);
      setDataSources([]);
      setCollapsedTabs({ audio: false, knowledge: false, sources: false });
      await Promise.all([
        loadAudio(nextGroup.id),
        loadKnowledgeBases(nextGroup.id),
        loadSources(nextGroup.id),
      ]);
    },
    [loadAudio, loadKnowledgeBases, loadSources],
  );

  const loadDirectory = useCallback(async () => {
    setDirectoryLoading(true);
    setDirectoryError('');
    try {
      const response = await listGroups();
      setGroups(response.items);
      const routedGroup = response.items.find((item) => item.id === requestedGroupId.current);
      const firstGroup = routedGroup ?? response.items[0];
      if (firstGroup) {
        await selectGroup(firstGroup);
        if (!routedGroup) onGroupChangeRef.current?.(firstGroup.id);
      } else {
        clearSelection();
        onGroupChangeRef.current?.(undefined);
      }
    } catch (reason) {
      setDirectoryError(reason instanceof Error ? reason.message : '分组加载失败。');
      setGroups([]);
      clearSelection();
    } finally {
      setDirectoryLoading(false);
    }
  }, [clearSelection, selectGroup]);

  useEffect(() => {
    const task = setTimeout(() => {
      void runInitialRequest(loadDirectory);
    }, 0);
    return () => clearTimeout(task);
  }, [loadDirectory, runInitialRequest]);

  useEffect(() => {
    if (
      directoryLoading ||
      groups.length === 0 ||
      previousRoutedGroupId.current === initialGroupId
    ) {
      return;
    }
    previousRoutedGroupId.current = initialGroupId;
    const routedGroup = groups.find((item) => item.id === initialGroupId);
    const nextGroup = routedGroup ?? groups[0];
    if (!nextGroup) return;
    void selectGroup(nextGroup);
    if (!routedGroup) onGroupChangeRef.current?.(nextGroup.id);
  }, [directoryLoading, groups, initialGroupId, selectGroup]);

  useEffect(() => {
    if (previousRoutedTab.current === initialTab) return;
    previousRoutedTab.current = initialTab;
    if (!initialTab) return;
    const task = setTimeout(() => setActiveTab(initialTab), 0);
    return () => clearTimeout(task);
  }, [initialTab]);

  const handleCreateGroup = async (name: string) => {
    setCreating(true);
    setCreateError('');
    try {
      const created = await createGroup({ name });
      setGroups((current) => [created, ...current]);
      void selectGroup(created, true);
      return true;
    } catch (reason) {
      setCreateError(reason instanceof Error ? reason.message : '创建分组失败。');
      return false;
    } finally {
      setCreating(false);
    }
  };

  const visibleAudio = useMemo(
    () => selectAudioItems(audioItems, searchQuery, audioStatuses, audioSortOrder),
    [audioItems, audioSortOrder, audioStatuses, searchQuery],
  );
  const visibleKnowledge = useMemo(
    () =>
      selectKnowledgeBases(
        knowledgeBases,
        searchQuery,
        knowledgeSortOrder,
        knowledgeDocumentFilter,
      ),
    [knowledgeBases, knowledgeDocumentFilter, knowledgeSortOrder, searchQuery],
  );
  const visibleSources = useMemo(
    () =>
      selectDataSources(dataSources, searchQuery, sourceSortOrder, sourceLocations, sourceStatuses),
    [dataSources, searchQuery, sourceLocations, sourceSortOrder, sourceStatuses],
  );

  const handleTabChange = useCallback((tab: TabKey) => {
    setActiveTab(tab);
    onTabChangeRef.current?.(tab);
  }, []);

  const { handleMomentumScrollEnd, pageWidth, pagerRef, selectTab } = useSwipePager({
    activeTab,
    onTabChange: handleTabChange,
    tabs: tabKeys,
  });

  const handleContentScroll = (tab: TabKey) => (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (event.nativeEvent.contentOffset.y <= spacing.xl) return;
    setCollapsedTabs((current) => {
      if (current[tab]) return current;
      collapsedAt.current[tab] = Date.now();
      return { ...current, [tab]: true };
    });
  };

  const handleScrollEnd = (tab: TabKey) => (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (event.nativeEvent.contentOffset.y <= 0) {
      setCollapsedTabs((current) =>
        current[tab] && Date.now() - collapsedAt.current[tab] >= headerCollapseGuardMs
          ? { ...current, [tab]: false }
          : current,
      );
    }
  };

  const searchEmpty = searchQuery ? `没有匹配“${searchQuery}”的内容` : '';

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      {drawerVisible ? (
        <GroupDrawer
          createError={createError}
          creating={creating}
          groups={groups}
          onClose={() => setDrawerVisible(false)}
          onCreate={handleCreateGroup}
          onOpenSettings={(target) => onOpenSettings?.(target.id)}
          onSelect={(target) => {
            void selectGroup(target, true);
          }}
          selectedGroupId={group?.id}
          visible
        />
      ) : null}
      {searchVisible ? (
        <SearchSheet
          appliedQuery={searchQuery}
          inputLabel="输入搜索关键词"
          onApply={(query) => {
            setSearchQuery(query);
            setSearchVisible(false);
          }}
          onClose={() => setSearchVisible(false)}
          placeholder="搜索音频、知识库或数据源"
          subtitle="查询会同时作用于三个标签页"
          title="搜索当前分组"
          visible
        />
      ) : null}
      {filterVisible ? (
        <GroupFilterSheet
          activeTab={activeTab}
          audioSortOrder={audioSortOrder}
          audioStatuses={audioStatuses}
          knowledgeDocumentFilter={knowledgeDocumentFilter}
          knowledgeSortOrder={knowledgeSortOrder}
          onApply={(value) => {
            if (value.tab === 'audio') {
              setAudioSortOrder(value.sortOrder);
              setAudioStatuses(value.statuses);
            } else if (value.tab === 'knowledge') {
              setKnowledgeSortOrder(value.sortOrder);
              setKnowledgeDocumentFilter(value.documentFilter);
            } else {
              setSourceSortOrder(value.sortOrder);
              setSourceLocations(value.locations);
              setSourceStatuses(value.statuses);
            }
            setFilterVisible(false);
          }}
          onClose={() => setFilterVisible(false)}
          sourceLocations={sourceLocations}
          sourceSortOrder={sourceSortOrder}
          sourceStatuses={sourceStatuses}
          visible
        />
      ) : null}

      <View style={styles.topBar}>
        <View style={styles.topLeft}>
          <IconButton
            icon="menu"
            label="菜单"
            onPress={() => {
              setCreateError('');
              setDrawerVisible(true);
            }}
          />
          {headerCollapsed ? (
            <Text testID="group-inline-title" style={styles.inlineTitle}>
              {group?.name}
            </Text>
          ) : null}
        </View>
        <View style={styles.topActions}>
          <IconButton
            disabled={!group}
            icon="search"
            label="搜索"
            onPress={() => setSearchVisible(true)}
          />
          <IconButton
            disabled={!group}
            icon="options-outline"
            label="分组设置"
            onPress={() => {
              if (group) onOpenSettings?.(group.id);
            }}
          />
        </View>
      </View>

      {!headerCollapsed ? (
        <Text testID="group-display-title" style={styles.displayTitle}>
          {directoryLoading ? '正在加载分组' : (group?.name ?? '暂无分组')}
        </Text>
      ) : null}

      {directoryLoading ? (
        <View style={styles.pageState}>
          <ActivityIndicator accessibilityLabel="正在加载分组目录" color={colors.ink} />
        </View>
      ) : !group ? (
        <View style={styles.pageState}>
          <Ionicons color={colors.muted} name="albums-outline" size={40} />
          <Text style={styles.emptyGroupTitle}>{directoryError || '还没有可用分组'}</Text>
          <Text style={styles.emptyGroupDescription}>
            {directoryError
              ? '请检查网络连接后重试。'
              : '打开分组菜单，创建一个分组后即可管理音频、知识库和数据源。'}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              if (directoryError) void loadDirectory();
              else setDrawerVisible(true);
            }}
            style={({ pressed }) => [styles.emptyGroupButton, pressed && styles.primaryPressed]}
          >
            <Text style={styles.emptyGroupButtonText}>
              {directoryError ? '重新加载分组' : '打开分组菜单'}
            </Text>
          </Pressable>
        </View>
      ) : (
        <>
          <PageTabs activeTab={activeTab} onChange={selectTab} tabs={tabs} />
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
                onMomentumScrollEnd={handleScrollEnd('audio')}
                onScroll={handleContentScroll('audio')}
                onScrollEndDrag={handleScrollEnd('audio')}
                scrollEventThrottle={16}
                showsVerticalScrollIndicator={false}
                testID="group-audio-scroll"
              >
                <AudioContent
                  emptyMessage={
                    searchEmpty ||
                    (audioStatuses.size ? '没有符合当前状态筛选的音频' : '当前分组还没有音频')
                  }
                  error={audioError}
                  items={visibleAudio}
                  loading={audioLoading}
                  onOpenAudio={(id) => {
                    if (group) onOpenAudio?.(id, group.id);
                  }}
                  onOpenFilter={() => setFilterVisible(true)}
                  onRetry={() => {
                    void loadAudio(group.id);
                  }}
                />
              </ScrollView>
            </View>
            <View style={[styles.page, { width: pageWidth }]}>
              <ScrollView
                contentContainerStyle={styles.scrollContent}
                onMomentumScrollEnd={handleScrollEnd('knowledge')}
                onScroll={handleContentScroll('knowledge')}
                onScrollEndDrag={handleScrollEnd('knowledge')}
                scrollEventThrottle={16}
                showsVerticalScrollIndicator={false}
                testID="group-knowledge-scroll"
              >
                <KnowledgeContent
                  emptyMessage={
                    searchEmpty ||
                    (knowledgeDocumentFilter !== 'all'
                      ? '没有符合当前文档筛选的知识库'
                      : '当前分组还没有关联知识库')
                  }
                  error={knowledgeError}
                  knowledgeBases={visibleKnowledge}
                  loading={knowledgeLoading}
                  onOpenFilter={() => setFilterVisible(true)}
                  onOpenKnowledge={(id) => onOpenKnowledge?.(id, group.id)}
                  onRetry={() => {
                    void loadKnowledgeBases(group.id);
                  }}
                />
              </ScrollView>
            </View>
            <View style={[styles.page, { width: pageWidth }]}>
              <ScrollView
                contentContainerStyle={styles.scrollContent}
                onMomentumScrollEnd={handleScrollEnd('sources')}
                onScroll={handleContentScroll('sources')}
                onScrollEndDrag={handleScrollEnd('sources')}
                scrollEventThrottle={16}
                showsVerticalScrollIndicator={false}
                testID="group-sources-scroll"
              >
                <DataSourcesContent
                  emptyMessage={
                    searchEmpty ||
                    (sourceLocations.size || sourceStatuses.size
                      ? '没有符合当前筛选的数据源'
                      : '当前分组还没有连接数据源')
                  }
                  error={sourcesError}
                  loading={sourcesLoading}
                  onOpenFilter={() => setFilterVisible(true)}
                  onOpenSource={(id) => {
                    if (group) onOpenSource?.(id, group.id);
                  }}
                  onRetry={() => {
                    void loadSources(group.id);
                  }}
                  sources={visibleSources}
                />
              </ScrollView>
            </View>
          </ScrollView>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.canvas, flex: 1 },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  topActions: { flexDirection: 'row', gap: spacing.md },
  topLeft: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  inlineTitle: {
    ...typography.heading2,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  iconButton: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
  disabled: { opacity: 0.35 },
  pressed: { backgroundColor: colors.background, borderRadius: radii.default },
  primaryPressed: { opacity: 0.78 },
  displayTitle: {
    ...typography.groupName,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
    marginBottom: spacing.xl,
    marginHorizontal: spacing.md,
    marginTop: spacing.xxl,
  },
  pager: { flex: 1 },
  page: { height: '100%' },
  scrollContent: {
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
  },
  pageState: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.md,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  emptyGroupTitle: {
    ...typography.heading1,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  emptyGroupDescription: {
    ...typography.body,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    maxWidth: 320,
    textAlign: 'center',
  },
  emptyGroupButton: {
    backgroundColor: colors.ink,
    borderRadius: radii.default,
    marginTop: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.base,
  },
  emptyGroupButtonText: {
    ...typography.description,
    color: colors.white,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
});
