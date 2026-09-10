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
  TemplateExample,
} from '@echowave/contracts';
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  getGroupTemplateExample,
  listGroupAudioFiles,
  listGroupDataSources,
  listGroupKnowledgeBases,
  listGroups,
  replaceGroupDataSources,
  replaceGroupKnowledgeBases,
} from '@/shared/api/groupsApi';
import { listDataSources } from '@/shared/api/dataSourcesApi';
import { listKnowledgeBases } from '@/shared/api/knowledgeBasesApi';
import { useSwipePager } from '@/shared/hooks/useSwipePager';
import { useScreenRefresh } from '@/shared/hooks/useScreenRefresh';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import { useInitialRequestLoading } from '@/shared/navigation/NavigationLoadingProvider';
import { useStarterTour, useStarterTourTarget } from '@/shared/onboarding/StarterTourContext';
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
import { ScreenRefreshControl } from '@/shared/ui/ScreenRefreshControl';
import { AudioContent } from './components/AudioContent';
import { DataSourcesContent } from './components/DataSourcesContent';
import { GroupDrawer } from './components/GroupDrawer';
import { GroupFilterSheet } from './components/GroupFilterSheet';
import { KnowledgeContent } from './components/KnowledgeContent';
import {
  GroupResourceLinkSheet,
  type GroupResourceLinkKind,
  type GroupResourceLinkOption,
} from './components/GroupResourceLinkSheet';
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
  { key: 'audio', labelKey: 'groups.tab.audio' },
  { key: 'knowledge', labelKey: 'groups.tab.knowledge' },
  { key: 'sources', labelKey: 'groups.tab.sources' },
] as const;

export type TabKey = (typeof tabs)[number]['key'];
const tabKeys = tabs.map((tab) => tab.key);
const headerCollapseGuardMs = 250;
type ResourceLinkRetryMode = 'load' | 'save';

const IconButton = forwardRef<
  View,
  {
    disabled?: boolean;
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    onPress: () => void;
  }
>(function IconButton({ disabled = false, icon, label, onPress }, ref) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      disabled={disabled}
      hitSlop={10}
      onPress={onPress}
      ref={ref}
      style={({ pressed }) => [
        styles.iconButton,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Ionicons color={colors.ink} name={icon} size={29} />
    </Pressable>
  );
});

/** 渲染分组工作区并协调分组目录与三个同级内容页。 */
export function GroupScreen({
  initialGroupId,
  initialTab,
  onOpenAudio,
  onOpenKnowledge,
  onOpenSource,
  onOpenSettings,
  onOpenTemplateExample,
  onGroupChange,
  onTabChange,
}: {
  initialGroupId?: string;
  initialTab?: TabKey;
  onOpenAudio?: (id: string, groupId: string) => void;
  onOpenKnowledge?: (id: string, groupId: string) => void;
  onOpenSource?: (id: string, groupId: string) => void;
  onOpenSettings?: (id: string) => void;
  onOpenTemplateExample?: (id: string) => void;
  onGroupChange?: (groupId?: string) => void;
  onTabChange?: (tab: TabKey) => void;
}) {
  const { t } = useAppLanguage();
  const runInitialRequest = useInitialRequestLoading();
  const { offerStarterTemplates } = useStarterTour();
  const menuTourRef = useStarterTourTarget('group-menu');
  const settingsTourRef = useStarterTourTarget('group-settings');
  const titleTourRef = useStarterTourTarget('group-title');
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
  const [templateExample, setTemplateExample] = useState<TemplateExample>();
  const [templateExampleLoading, setTemplateExampleLoading] = useState(false);
  const [templateExampleError, setTemplateExampleError] = useState('');
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseSummary[]>([]);
  const [knowledgeLoading, setKnowledgeLoading] = useState(true);
  const [knowledgeError, setKnowledgeError] = useState('');
  const [dataSources, setDataSources] = useState<DataSourceSummary[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [sourcesError, setSourcesError] = useState('');
  const [resourceLinkKind, setResourceLinkKind] = useState<GroupResourceLinkKind>();
  const [resourceLinkOptions, setResourceLinkOptions] = useState<GroupResourceLinkOption[]>([]);
  const [resourceLinkSelectedIds, setResourceLinkSelectedIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [resourceLinkLoading, setResourceLinkLoading] = useState(false);
  const [resourceLinkError, setResourceLinkError] = useState('');
  const [resourceLinkRetryMode, setResourceLinkRetryMode] = useState<ResourceLinkRetryMode>('load');
  const [resourceLinkSaving, setResourceLinkSaving] = useState(false);
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

  const loadKnowledgeBases = useCallback(
    async (groupId: string) => {
      setKnowledgeLoading(true);
      setKnowledgeError('');
      try {
        const response = await listGroupKnowledgeBases(groupId);
        if (selectedGroupId.current === groupId) setKnowledgeBases(response.items);
      } catch (reason) {
        if (selectedGroupId.current === groupId) {
          setKnowledgeError(
            reason instanceof Error ? reason.message : t('groups.loadKnowledgeFailed'),
          );
        }
      } finally {
        if (selectedGroupId.current === groupId) setKnowledgeLoading(false);
      }
    },
    [t],
  );

  const loadAudio = useCallback(
    async (groupId: string) => {
      setAudioLoading(true);
      setAudioError('');
      try {
        const response = await listGroupAudioFiles(groupId);
        if (selectedGroupId.current === groupId) setAudioItems(response.items);
      } catch (reason) {
        if (selectedGroupId.current === groupId) {
          setAudioError(reason instanceof Error ? reason.message : t('groups.loadAudioFailed'));
        }
      } finally {
        if (selectedGroupId.current === groupId) setAudioLoading(false);
      }
    },
    [t],
  );

  const loadTemplateExample = useCallback(
    async (nextGroup: GroupSummary) => {
      setTemplateExample(undefined);
      setTemplateExampleError('');
      if (!nextGroup.starterTemplateKey) {
        setTemplateExampleLoading(false);
        return;
      }
      setTemplateExampleLoading(true);
      try {
        const response = await getGroupTemplateExample(nextGroup.id);
        if (selectedGroupId.current === nextGroup.id) setTemplateExample(response);
      } catch (reason) {
        if (selectedGroupId.current === nextGroup.id) {
          setTemplateExampleError(
            reason instanceof Error ? reason.message : t('groups.loadExampleFailed'),
          );
        }
      } finally {
        if (selectedGroupId.current === nextGroup.id) setTemplateExampleLoading(false);
      }
    },
    [t],
  );

  const loadSources = useCallback(
    async (groupId: string) => {
      setSourcesLoading(true);
      setSourcesError('');
      try {
        const response = await listGroupDataSources(groupId);
        if (selectedGroupId.current === groupId) setDataSources(response.items);
      } catch (reason) {
        if (selectedGroupId.current === groupId) {
          setSourcesError(reason instanceof Error ? reason.message : t('groups.loadSourcesFailed'));
        }
      } finally {
        if (selectedGroupId.current === groupId) setSourcesLoading(false);
      }
    },
    [t],
  );

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
    setTemplateExample(undefined);
    setTemplateExampleError('');
    setTemplateExampleLoading(false);
    setKnowledgeBases([]);
    setDataSources([]);
    setAudioError('');
    setKnowledgeError('');
    setSourcesError('');
    setAudioLoading(false);
    setKnowledgeLoading(false);
    setSourcesLoading(false);
    setResourceLinkKind(undefined);
    setResourceLinkOptions([]);
    setResourceLinkSelectedIds(new Set());
    setResourceLinkLoading(false);
    setResourceLinkError('');
    setResourceLinkRetryMode('load');
    setResourceLinkSaving(false);
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
      setTemplateExample(undefined);
      setTemplateExampleError('');
      setKnowledgeBases([]);
      setDataSources([]);
      setResourceLinkKind(undefined);
      setResourceLinkOptions([]);
      setResourceLinkSelectedIds(new Set());
      setResourceLinkLoading(false);
      setResourceLinkError('');
      setResourceLinkRetryMode('load');
      setResourceLinkSaving(false);
      setCollapsedTabs({ audio: false, knowledge: false, sources: false });
      await Promise.all([
        loadAudio(nextGroup.id),
        loadTemplateExample(nextGroup),
        loadKnowledgeBases(nextGroup.id),
        loadSources(nextGroup.id),
      ]);
    },
    [loadAudio, loadKnowledgeBases, loadSources, loadTemplateExample],
  );

  const loadDirectory = useCallback(
    async (showLoading = true) => {
      if (showLoading) setDirectoryLoading(true);
      setDirectoryError('');
      try {
        const response = await listGroups();
        setGroups(response.items);
        offerStarterTemplates(response.items);
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
        setDirectoryError(reason instanceof Error ? reason.message : t('groups.loadFailed'));
        setGroups([]);
        clearSelection();
      } finally {
        if (showLoading) setDirectoryLoading(false);
      }
    },
    [clearSelection, offerStarterTemplates, selectGroup, t],
  );

  const refreshPage = useCallback(async () => {
    await loadDirectory(false);
    const groupId = selectedGroupId.current;
    if (!groupId) return;
    const currentGroup = groups.find((item) => item.id === groupId);
    await Promise.all([
      loadAudio(groupId),
      currentGroup ? loadTemplateExample(currentGroup) : Promise.resolve(),
      loadKnowledgeBases(groupId),
      loadSources(groupId),
    ]);
  }, [groups, loadAudio, loadDirectory, loadKnowledgeBases, loadSources, loadTemplateExample]);
  const screenRefresh = useScreenRefresh(refreshPage);

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
      setCreateError(reason instanceof Error ? reason.message : t('groups.createFailed'));
      return false;
    } finally {
      setCreating(false);
    }
  };

  const closeResourceLinkSheet = useCallback(() => {
    setResourceLinkKind(undefined);
    setResourceLinkOptions([]);
    setResourceLinkSelectedIds(new Set());
    setResourceLinkLoading(false);
    setResourceLinkError('');
    setResourceLinkRetryMode('load');
  }, []);

  const openResourceLinkSheet = useCallback(
    (kind: GroupResourceLinkKind) => {
      if (!group) return;
      const groupId = group.id;
      const linkedItems = kind === 'knowledge' ? knowledgeBases : dataSources;
      setResourceLinkKind(kind);
      setResourceLinkOptions([]);
      setResourceLinkSelectedIds(new Set(linkedItems.map((item) => item.id)));
      setResourceLinkLoading(true);
      setResourceLinkError('');
      setResourceLinkRetryMode('load');
      void (async () => {
        try {
          if (kind === 'knowledge') {
            const response = await listKnowledgeBases();
            if (selectedGroupId.current !== groupId) return;
            setResourceLinkOptions(
              response.items.map((item) => ({
                id: item.id,
                name: item.name,
                description: item.description || t('groupSettings.noDescription'),
              })),
            );
          } else {
            const response = await listDataSources();
            if (selectedGroupId.current !== groupId) return;
            setResourceLinkOptions(
              response.items.map((item) => ({
                id: item.id,
                name: item.name,
                description: item.description || item.connectionLabel,
              })),
            );
          }
        } catch (reason) {
          if (selectedGroupId.current === groupId) {
            setResourceLinkError(
              reason instanceof Error
                ? reason.message
                : kind === 'knowledge'
                  ? t('groups.loadKnowledgeFailed')
                  : t('groups.loadSourcesFailed'),
            );
          }
        } finally {
          if (selectedGroupId.current === groupId) setResourceLinkLoading(false);
        }
      })();
    },
    [dataSources, group, knowledgeBases, t],
  );

  const toggleResourceLink = useCallback((id: string) => {
    setResourceLinkSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const confirmResourceLinks = useCallback(async () => {
    const kind = resourceLinkKind;
    const currentGroup = group;
    if (!kind || !currentGroup || resourceLinkSaving || resourceLinkSelectedIds.size === 0) {
      return;
    }
    const groupId = currentGroup.id;
    setResourceLinkSaving(true);
    setResourceLinkError('');
    setResourceLinkRetryMode('save');
    try {
      if (kind === 'knowledge') {
        const response = await replaceGroupKnowledgeBases(groupId, {
          ids: [...resourceLinkSelectedIds],
        });
        if (selectedGroupId.current !== groupId) return;
        setKnowledgeBases(response.items);
      } else {
        const response = await replaceGroupDataSources(groupId, {
          ids: [...resourceLinkSelectedIds],
        });
        if (selectedGroupId.current !== groupId) return;
        setDataSources(response.items);
      }
      closeResourceLinkSheet();
    } catch (reason) {
      if (selectedGroupId.current === groupId) {
        setResourceLinkError(
          reason instanceof Error ? reason.message : t('groupSettings.linksFailed'),
        );
      }
    } finally {
      setResourceLinkSaving(false);
    }
  }, [
    closeResourceLinkSheet,
    group,
    resourceLinkKind,
    resourceLinkSaving,
    resourceLinkSelectedIds,
    t,
  ]);

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

  const searchEmpty = searchQuery ? t('groups.noMatch', { query: searchQuery }) : '';
  const showKnowledgeLinkAction =
    knowledgeBases.length === 0 && !searchQuery && knowledgeDocumentFilter === 'all';
  const showSourceLinkAction =
    dataSources.length === 0 &&
    !searchQuery &&
    sourceLocations.size === 0 &&
    sourceStatuses.size === 0;
  const localizedTabs = tabs.map((tab) => ({ key: tab.key, label: t(tab.labelKey) }));

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
          inputLabel={t('groups.searchInput')}
          onApply={(query) => {
            setSearchQuery(query);
            setSearchVisible(false);
          }}
          onClose={() => setSearchVisible(false)}
          placeholder={t('groups.searchPlaceholder')}
          subtitle={t('groups.searchSubtitle')}
          title={t('groups.searchTitle')}
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
      <GroupResourceLinkSheet
        error={resourceLinkError}
        kind={resourceLinkKind ?? 'knowledge'}
        loading={resourceLinkLoading}
        onClose={closeResourceLinkSheet}
        onConfirm={() => void confirmResourceLinks()}
        onRetry={() => {
          if (!resourceLinkKind) return;
          if (resourceLinkRetryMode === 'save') void confirmResourceLinks();
          else openResourceLinkSheet(resourceLinkKind);
        }}
        onToggle={toggleResourceLink}
        options={resourceLinkOptions}
        pending={resourceLinkSaving}
        selectedIds={resourceLinkSelectedIds}
        visible={resourceLinkKind !== undefined}
      />

      <View style={styles.topBar} testID="group-top-bar">
        <View style={styles.topLeft}>
          <IconButton
            icon="menu"
            label={t('groups.menu')}
            onPress={() => {
              setCreateError('');
              setDrawerVisible(true);
            }}
            ref={menuTourRef}
          />
          {headerCollapsed ? (
            <View style={styles.inlineTitleRow}>
              <Text testID="group-inline-title" style={styles.inlineTitle}>
                {group?.name}
              </Text>
              {group?.starterTemplateKey ? (
                <Text style={styles.templateBadge}>{t('groups.template')}</Text>
              ) : null}
            </View>
          ) : null}
        </View>
        <View style={styles.topActions}>
          <IconButton
            disabled={!group}
            icon="search"
            label={t('common.search')}
            onPress={() => setSearchVisible(true)}
          />
          <IconButton
            disabled={!group}
            icon="options-outline"
            label={t('groups.settings')}
            onPress={() => {
              if (group) onOpenSettings?.(group.id);
            }}
            ref={settingsTourRef}
          />
        </View>
      </View>

      {!headerCollapsed ? (
        <View collapsable={false} ref={titleTourRef} style={styles.displayTitleRow}>
          <Text testID="group-display-title" style={styles.displayTitle}>
            {directoryLoading ? t('groups.loading') : (group?.name ?? t('groups.empty'))}
          </Text>
          {group?.starterTemplateKey ? (
            <Text style={styles.templateBadge}>{t('groups.template')}</Text>
          ) : null}
        </View>
      ) : null}

      {directoryLoading ? (
        <View style={styles.pageState}>
          <ActivityIndicator accessibilityLabel={t('groups.loadingDirectory')} color={colors.ink} />
        </View>
      ) : !group ? (
        <ScrollView
          alwaysBounceVertical
          contentContainerStyle={styles.pageState}
          refreshControl={<ScreenRefreshControl {...screenRefresh} />}
        >
          <Ionicons color={colors.muted} name="albums-outline" size={40} />
          <Text style={styles.emptyGroupTitle}>{directoryError || t('groups.noneAvailable')}</Text>
          <Text style={styles.emptyGroupDescription}>
            {directoryError ? t('groups.retryHint') : t('groups.emptyHint')}
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
              {directoryError ? t('groups.reload') : t('groups.openMenu')}
            </Text>
          </Pressable>
        </ScrollView>
      ) : (
        <>
          <PageTabs
            activeTab={activeTab}
            onChange={selectTab}
            tabs={localizedTabs}
            testIDPrefix="group-tab"
          />
          <ScrollView
            accessibilityLabel={t('groups.pager')}
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
                alwaysBounceVertical
                contentContainerStyle={styles.scrollContent}
                onMomentumScrollEnd={handleScrollEnd('audio')}
                onScroll={handleContentScroll('audio')}
                onScrollEndDrag={handleScrollEnd('audio')}
                refreshControl={<ScreenRefreshControl {...screenRefresh} />}
                scrollEventThrottle={16}
                showsVerticalScrollIndicator={false}
                testID="group-audio-scroll"
              >
                <AudioContent
                  emptyMessage={
                    searchEmpty ||
                    (audioStatuses.size ? t('groups.noAudioFilter') : t('groups.noAudio'))
                  }
                  error={audioError}
                  items={visibleAudio}
                  loading={audioLoading}
                  onOpenAudio={(id) => {
                    if (group) onOpenAudio?.(id, group.id);
                  }}
                  onOpenFilter={() => setFilterVisible(true)}
                  onOpenTemplateExample={() => onOpenTemplateExample?.(group.id)}
                  onRetry={() => {
                    void loadAudio(group.id);
                  }}
                  onRetryTemplateExample={() => {
                    void loadTemplateExample(group);
                  }}
                  templateExample={templateExample}
                  templateExampleError={templateExampleError}
                  templateExampleLoading={templateExampleLoading}
                />
              </ScrollView>
            </View>
            <View style={[styles.page, { width: pageWidth }]}>
              <ScrollView
                alwaysBounceVertical
                contentContainerStyle={styles.scrollContent}
                onMomentumScrollEnd={handleScrollEnd('knowledge')}
                onScroll={handleContentScroll('knowledge')}
                onScrollEndDrag={handleScrollEnd('knowledge')}
                refreshControl={<ScreenRefreshControl {...screenRefresh} />}
                scrollEventThrottle={16}
                showsVerticalScrollIndicator={false}
                testID="group-knowledge-scroll"
              >
                <KnowledgeContent
                  emptyMessage={
                    searchEmpty ||
                    (knowledgeDocumentFilter !== 'all'
                      ? t('groups.noKnowledgeFilter')
                      : t('groups.noKnowledge'))
                  }
                  error={knowledgeError}
                  knowledgeBases={visibleKnowledge}
                  loading={knowledgeLoading}
                  onLink={() => openResourceLinkSheet('knowledge')}
                  onOpenFilter={() => setFilterVisible(true)}
                  onOpenKnowledge={(id) => onOpenKnowledge?.(id, group.id)}
                  onRetry={() => {
                    void loadKnowledgeBases(group.id);
                  }}
                  showLinkAction={showKnowledgeLinkAction}
                />
              </ScrollView>
            </View>
            <View style={[styles.page, { width: pageWidth }]}>
              <ScrollView
                alwaysBounceVertical
                contentContainerStyle={styles.scrollContent}
                onMomentumScrollEnd={handleScrollEnd('sources')}
                onScroll={handleContentScroll('sources')}
                onScrollEndDrag={handleScrollEnd('sources')}
                refreshControl={<ScreenRefreshControl {...screenRefresh} />}
                scrollEventThrottle={16}
                showsVerticalScrollIndicator={false}
                testID="group-sources-scroll"
              >
                <DataSourcesContent
                  emptyMessage={
                    searchEmpty ||
                    (sourceLocations.size || sourceStatuses.size
                      ? t('groups.noSourceFilter')
                      : t('groups.noSources'))
                  }
                  error={sourcesError}
                  loading={sourcesLoading}
                  onOpenFilter={() => setFilterVisible(true)}
                  onLink={() => openResourceLinkSheet('sources')}
                  onOpenSource={(id) => {
                    if (group) onOpenSource?.(id, group.id);
                  }}
                  onRetry={() => {
                    void loadSources(group.id);
                  }}
                  showLinkAction={showSourceLinkAction}
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
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
  },
  topActions: { flexDirection: 'row', gap: spacing.sm },
  topLeft: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  inlineTitle: {
    ...typography.heading2,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  inlineTitleRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs },
  iconButton: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
  disabled: { opacity: 0.35 },
  pressed: { backgroundColor: colors.background, borderRadius: radii.default },
  primaryPressed: { opacity: 0.78 },
  displayTitle: {
    ...typography.groupName,
    color: textColors.primary,
    flexShrink: 1,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  displayTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.xl,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
  },
  templateBadge: {
    ...typography.label,
    backgroundColor: colors.successSurface,
    borderRadius: radii.round,
    color: colors.success,
    fontFamily: fontFamilies.sansBold,
    overflow: 'hidden',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
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
