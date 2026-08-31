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
  archiveGroup,
  createGroup,
  listGroupAudioFiles,
  listGroupDataSources,
  listGroupKnowledgeBases,
  listGroups,
} from '@/shared/api/groupsApi';
import { useSwipePager } from '@/shared/hooks/useSwipePager';
import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';
import { PageTabs } from '@/shared/ui/PageTabs';
import { AudioContent } from './components/AudioContent';
import { AudioFilterSheet } from './components/AudioFilterSheet';
import { DataSourcesContent } from './components/DataSourcesContent';
import { GroupArchiveDialog, GroupDrawer } from './components/GroupDrawer';
import { GroupSearchSheet } from './components/GroupSearchSheet';
import { KnowledgeContent } from './components/KnowledgeContent';
import {
  selectAudioItems,
  selectDataSources,
  selectKnowledgeBases,
  type AudioSortOrder,
  type AudioStatusKind,
} from './model';

const tabs = [
  { key: 'audio', label: '音频分析' },
  { key: 'knowledge', label: '关联知识库' },
  { key: 'sources', label: '连接数据源' },
] as const;

type TabKey = (typeof tabs)[number]['key'];
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
}: {
  initialGroupId?: string;
  initialTab?: TabKey;
  onOpenAudio?: (id: string, groupId: string) => void;
  onOpenKnowledge?: (id: string) => void;
  onOpenSource?: (id: string, groupId: string) => void;
  onOpenSettings?: (id: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab ?? 'audio');
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [group, setGroup] = useState<GroupSummary>();
  const [directoryLoading, setDirectoryLoading] = useState(true);
  const [directoryError, setDirectoryError] = useState('');
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [archiveTarget, setArchiveTarget] = useState<GroupSummary>();
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState('');
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterVisible, setFilterVisible] = useState(false);
  const [audioSortOrder, setAudioSortOrder] = useState<AudioSortOrder>('newest');
  const [audioStatuses, setAudioStatuses] = useState<Set<AudioStatusKind>>(() => new Set());
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
  const collapsedAt = useRef<Record<TabKey, number>>({
    audio: 0,
    knowledge: 0,
    sources: 0,
  });

  const headerCollapsed = Boolean(group) && collapsedTabs[activeTab];

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
    (nextGroup: GroupSummary) => {
      if (selectedGroupId.current === nextGroup.id) {
        return;
      }
      selectedGroupId.current = nextGroup.id;
      setGroup(nextGroup);
      setSearchQuery('');
      setAudioSortOrder('newest');
      setAudioStatuses(new Set());
      setAudioItems([]);
      setKnowledgeBases([]);
      setDataSources([]);
      setCollapsedTabs({ audio: false, knowledge: false, sources: false });
      void Promise.all([
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
      const firstGroup =
        response.items.find((item) => item.id === initialGroupId) ?? response.items[0];
      if (firstGroup) selectGroup(firstGroup);
      else clearSelection();
    } catch (reason) {
      setDirectoryError(reason instanceof Error ? reason.message : '分组加载失败。');
      clearSelection();
    } finally {
      setDirectoryLoading(false);
    }
  }, [clearSelection, initialGroupId, selectGroup]);

  useEffect(() => {
    const task = setTimeout(() => {
      void loadDirectory();
    }, 0);
    return () => clearTimeout(task);
  }, [loadDirectory]);

  const handleCreateGroup = async (name: string) => {
    setCreating(true);
    setCreateError('');
    try {
      const created = await createGroup({ name });
      setGroups((current) => [created, ...current]);
      selectGroup(created);
      return true;
    } catch (reason) {
      setCreateError(reason instanceof Error ? reason.message : '创建分组失败。');
      return false;
    } finally {
      setCreating(false);
    }
  };

  const requestArchive = (target: GroupSummary) => {
    setArchiveError('');
    setDrawerVisible(false);
    setArchiveTarget(target);
  };

  const confirmArchive = async () => {
    if (!archiveTarget || archiving) return;
    const target = archiveTarget;
    setArchiving(true);
    setArchiveError('');
    try {
      await archiveGroup(target.id);
      const remaining = groups.filter((item) => item.id !== target.id);
      setGroups(remaining);
      setArchiveTarget(undefined);
      if (group?.id === target.id) {
        const nextGroup = remaining[0];
        if (nextGroup) selectGroup(nextGroup);
        else {
          clearSelection();
          setDrawerVisible(false);
        }
      } else {
        setDrawerVisible(true);
      }
    } catch (reason) {
      setArchiveError(reason instanceof Error ? reason.message : '归档分组失败。');
    } finally {
      setArchiving(false);
    }
  };

  const visibleAudio = useMemo(
    () => selectAudioItems(audioItems, searchQuery, audioStatuses, audioSortOrder),
    [audioItems, audioSortOrder, audioStatuses, searchQuery],
  );
  const visibleKnowledge = useMemo(
    () => selectKnowledgeBases(knowledgeBases, searchQuery),
    [knowledgeBases, searchQuery],
  );
  const visibleSources = useMemo(
    () => selectDataSources(dataSources, searchQuery),
    [dataSources, searchQuery],
  );

  const { handleMomentumScrollEnd, pageWidth, pagerRef, selectTab } = useSwipePager({
    activeTab,
    onTabChange: setActiveTab,
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
          onRequestArchive={requestArchive}
          onSelect={selectGroup}
          selectedGroupId={group?.id}
          visible
        />
      ) : null}
      <GroupArchiveDialog
        error={archiveError}
        group={archiveTarget}
        onCancel={() => {
          if (!archiving) {
            setArchiveTarget(undefined);
            setDrawerVisible(true);
          }
        }}
        onConfirm={() => {
          void confirmArchive();
        }}
        pending={archiving}
      />
      {searchVisible ? (
        <GroupSearchSheet
          appliedQuery={searchQuery}
          onApply={(query) => {
            setSearchQuery(query);
            setSearchVisible(false);
          }}
          onClose={() => setSearchVisible(false)}
          visible
        />
      ) : null}
      {filterVisible ? (
        <AudioFilterSheet
          onApply={(sortOrder, statuses) => {
            setAudioSortOrder(sortOrder);
            setAudioStatuses(statuses);
            setFilterVisible(false);
          }}
          onClose={() => setFilterVisible(false)}
          selectedStatuses={audioStatuses}
          sortOrder={audioSortOrder}
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
        {!headerCollapsed ? (
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
              label="设置筛选"
              onPress={() => {
                if (group) onOpenSettings?.(group.id);
              }}
            />
          </View>
        ) : null}
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
                  emptyMessage={searchEmpty || '当前分组还没有关联知识库'}
                  error={knowledgeError}
                  knowledgeBases={visibleKnowledge}
                  loading={knowledgeLoading}
                  onOpenKnowledge={(id) => onOpenKnowledge?.(id)}
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
                  emptyMessage={searchEmpty || '当前分组还没有连接数据源'}
                  error={sourcesError}
                  loading={sourcesLoading}
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
