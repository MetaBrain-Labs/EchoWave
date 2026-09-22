/**
 * 知识库详情页面。
 *
 * 组合知识库概览、文档列表和关联分组三个可滑动页面，并协调上传、关联和跨页切组。
 *
 * Responsibilities:
 * - 加载知识库概览、文档和关联分组事实。
 * - 提供面向文档标题、格式和解析状态的详情搜索。
 * - 协调上传状态订阅、文档重试、批量关联和目标分组确认。
 * - 保持三个同级页面独立纵向滚动及固定操作栏。
 *
 * Notes:
 * - 知识库配置当前只读；实际解析仍由服务端全局配置驱动。
 */
import { listKnowledgeDirectory } from '@/shared/api/collectionFoldersApi';
import { FixedActionButton } from '@/shared/ui/FixedActionButton';
import { ActionSheet } from '@/shared/ui/ActionSheet';
import { CollectionFolderRow } from '../components/CollectionFolderRow';
import { KnowledgeCaseActions } from '../components/KnowledgeCaseActions';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type {
  CollectionFolder,
  KnowledgeDirectoryEntry,
  DocumentStatus,
  GroupSummary,
  KnowledgeBaseDetail,
  KnowledgeDocument,
} from '@echowave/contracts';

import { linkKnowledgeBaseGroups, listKnowledgeBaseGroups } from '@/shared/api/knowledgeBasesApi';
import { pickDocumentAsync } from '@/shared/files/documentPicker';
import { useSwipePager } from '@/shared/hooks/useSwipePager';
import { useGroupAssociationEditor } from '@/shared/hooks/useGroupAssociationEditor';
import { useScreenRefresh } from '@/shared/hooks/useScreenRefresh';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import { PageHeader } from '@/shared/ui/PageHeader';
import { PageTabs } from '@/shared/ui/PageTabs';
import { SearchSheet } from '@/shared/ui/SearchSheet';
import { ScreenRefreshControl } from '@/shared/ui/ScreenRefreshControl';
import { useInitialRequestLoading } from '@/shared/navigation/NavigationLoadingProvider';
import { useStarterTourTarget } from '@/shared/onboarding/StarterTourContext';
import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';
import { DocumentFormatIcon, DocumentStatusView } from '../components/DocumentUi';
import { KnowledgeDocumentEditor } from '../components/KnowledgeDocumentEditor';
import { EmptyState } from '../components/EmptyState';
import {
  KnowledgeGroupPicker,
  KnowledgeGroupSwitchDialog,
} from '../components/KnowledgeGroupDialogs';
import { SearchAndFilter } from '../components/SearchAndFilter';
import { getKnowledgeBase, listDocuments, retryDocument, uploadDocument } from '../apiClient';
import { useKnowledgeDocumentUpdates } from '../hooks/useKnowledgeDocumentUpdates';
import { GuideDemoBanner } from '../components/GuideDemoBanner';
import { guideDemoDocument, guideDemoKnowledge } from '../guideDemoData';

const detailTabs = [
  { key: 'overview', labelKey: 'knowledgeDetail.tabOverview' },
  { key: 'files', labelKey: 'knowledgeDetail.tabFiles' },
  { key: 'groups', labelKey: 'knowledgeDetail.tabGroups' },
] as const;
type DetailTab = (typeof detailTabs)[number]['key'];
const detailTabKeys = detailTabs.map((tab) => tab.key);
type DocumentFilter = 'all' | 'ready' | 'pending' | 'failed';

function formatBytes(sizeBytes: number) {
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  if (sizeBytes < 1024 * 1024 * 1024) return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(sizeBytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function statusLabel(status: DocumentStatus, t: ReturnType<typeof useAppLanguage>['t']) {
  switch (status.kind) {
    case 'ready':
      return t('knowledgeDetail.ready');
    case 'queued':
      return t('knowledgeDetail.queued');
    case 'validating':
      return t('knowledgeDetail.validating');
    case 'parsing':
    case 'chunking':
      return t('knowledgeDetail.parsing');
    case 'embedding':
      return t('knowledgeDetail.embedding', { progress: status.progress });
    case 'failed':
      return t('knowledgeDetail.failed');
    case 'deleted':
    case 'deleting':
      return t('knowledgeDetail.deleting');
  }
}

function Metric({
  divider = false,
  label,
  value,
}: {
  divider?: boolean;
  label: string;
  value: string;
}) {
  return (
    <View style={[styles.metric, divider && styles.metricDivider]}>
      <Text numberOfLines={1} style={styles.metricValue}>
        {value}
      </Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoLabelRow}>
        <Ionicons color={colors.secondary} name={icon} size={typography.description.lineHeight} />
        <Text style={styles.infoLabel}>{label}</Text>
      </View>
      <Text numberOfLines={1} style={styles.infoValue}>
        {value}
      </Text>
    </View>
  );
}

/** 文档主体打开内容，右侧操作区独立打开抽屉，失败案例也可读取正文。 */
export function DocumentRow({
  document,
  onMore,
  onOpen,
}: {
  document: KnowledgeDocument;
  onMore: () => void;
  onOpen: () => void;
}) {
  const { formatDateTime, t } = useAppLanguage();
  const enabled = !!document.caseId || document.status.kind === 'ready';
  const formatLabel =
    document.format === 'spreadsheet'
      ? t('knowledgeDetail.spreadsheet')
      : document.format === 'word'
        ? 'Word'
        : 'Markdown';
  const content = (
    <>
      <DocumentFormatIcon format={document.format} size={40} />
      <View style={styles.documentMain}>
        <Text numberOfLines={1} style={styles.documentTitle}>
          {document.title}
        </Text>
        <Text style={styles.documentMeta}>
          {formatLabel} · {formatBytes(document.sizeBytes)}
        </Text>
        <Text style={styles.documentUpdated}>
          {t('knowledge.updated', { date: formatDateTime(document.updatedAt) })}
        </Text>
        {document.latestRevision?.error ? (
          <Text style={styles.failureReason}>{document.latestRevision.error.message}</Text>
        ) : null}
        {document.status.kind === 'failed' ? (
          <Text numberOfLines={2} style={styles.failureReason}>
            {document.status.message}
          </Text>
        ) : null}
      </View>
      <View style={styles.documentStatus}>
        <DocumentStatusView document={document} />
      </View>
    </>
  );
  return (
    <View style={styles.documentRow}>
      {enabled ? (
        <Pressable
          accessibilityLabel={t('knowledgeDetail.openFile', { title: document.title })}
          accessibilityRole="button"
          onPress={onOpen}
          style={({ pressed }) => [styles.documentOpen, pressed && styles.pressed]}
        >
          {content}
        </Pressable>
      ) : (
        <View style={styles.documentOpen}>{content}</View>
      )}
      <Pressable
        accessibilityLabel={t('knowledgeDetail.fileActions', { title: document.title })}
        accessibilityRole="button"
        hitSlop={8}
        onPress={onMore}
        style={({ pressed }) => [styles.moreButton, pressed && styles.pressed]}
      >
        <Ionicons color={colors.ink} name="ellipsis-vertical" size={24} />
      </Pressable>
    </View>
  );
}

function GroupCard({ group, onSwitch }: { group: GroupSummary; onSwitch: () => void }) {
  const { formatNumber, t } = useAppLanguage();
  return (
    <View style={styles.groupCard}>
      <View style={styles.groupTitleRow}>
        <Text numberOfLines={1} style={styles.groupTitle}>
          {group.name}
        </Text>
        <Pressable
          accessibilityLabel={t('knowledgeDetail.switchGroup', { name: group.name })}
          accessibilityRole="button"
          hitSlop={8}
          onPress={onSwitch}
          style={({ pressed }) => [styles.switchButton, pressed && styles.pressed]}
        >
          <Ionicons
            color={colors.secondary}
            name="swap-horizontal"
            size={typography.heading2.lineHeight}
          />
        </Pressable>
      </View>
      <View style={styles.groupStats}>
        <Metric
          label={t('knowledgeDetail.analysisCount')}
          value={formatNumber(group.metrics.analysisCount)}
        />
        <Metric
          divider
          label={t('knowledgeDetail.audioCount')}
          value={formatNumber(group.metrics.audioCount)}
        />
        <Metric
          divider
          label={t('knowledgeDetail.knowledgeCount')}
          value={formatNumber(group.metrics.knowledgeCount)}
        />
        <Metric
          divider
          label={t('knowledgeDetail.sourceCount')}
          value={formatNumber(group.metrics.sourceCount)}
        />
      </View>
    </View>
  );
}

/** 加载并展示知识库详情，协调上传、关联、切组与问答入口。 */
export function KnowledgeDetailScreen({
  guideDemo = false,
  knowledgeId,
  onBack,
  onAsk,
  onOpenDocument,
  onSwitchGroup,
  onOpenCases,
  onOpenCollection,
  onOpenFolder,
  onViewRule,
  onOrganize,
  onEditCase,
  onEditBase,
}: {
  guideDemo?: boolean;
  knowledgeId: string;
  onBack: () => void;
  onAsk?: () => void;
  onOpenDocument: (documentId: string) => void;
  onSwitchGroup?: (groupId: string) => void;
  onOpenCases?: (caseId?: string) => void;
  onOpenCollection?: (associatedGroupIds: string[]) => void;
  onOpenFolder?: (folderId: string, query: string) => void;
  onViewRule?: (folder: CollectionFolder) => void;
  onOrganize?: (folder: CollectionFolder) => void;
  onEditCase?: (caseId: string) => void;
  onEditBase?: () => void;
}) {
  const { formatDateTime, formatNumber, t } = useAppLanguage();
  const [knowledge, setKnowledge] = useState<KnowledgeBaseDetail>();
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [directory, setDirectory] = useState<KnowledgeDirectoryEntry[]>([]);
  const [searchedDirectory, setSearchedDirectory] = useState<{
    query: string;
    items: KnowledgeDirectoryEntry[];
  }>();
  const [actionFolder, setActionFolder] = useState<CollectionFolder>();
  const [linkedGroups, setLinkedGroups] = useState<GroupSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [appActive, setAppActive] = useState(AppState.currentState !== 'background');
  const [activeTab, setActiveTab] = useState<DetailTab>('overview');
  const [query, setQuery] = useState('');
  const [documentFilter, setDocumentFilter] = useState<DocumentFilter>('all');
  const [documentFilterVisible, setDocumentFilterVisible] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const [switchTarget, setSwitchTarget] = useState<GroupSummary>();
  const [actionDocument, setActionDocument] = useState<KnowledgeDocument>();
  const runInitialRequest = useInitialRequestLoading();
  const { handleMomentumScrollEnd, pageWidth, pagerRef, selectTab } = useSwipePager({
    activeTab,
    onTabChange: setActiveTab,
    tabs: detailTabKeys,
  });
  const overviewTargetRef = useStarterTourTarget('knowledge-overview');
  const filesTargetRef = useStarterTourTarget('knowledge-files');
  const uploadTargetRef = useStarterTourTarget('knowledge-upload');

  const load = useCallback(
    async (showLoading = true) => {
      if (showLoading) setLoading(true);
      setError('');
      if (guideDemo) {
        setKnowledge(guideDemoKnowledge);
        setDirectory([]);
        setDocuments([guideDemoDocument]);
        setLinkedGroups([]);
        if (showLoading) setLoading(false);
        return;
      }
      try {
        const [nextKnowledge, nextDocuments, nextGroups, nextDirectory] = await Promise.all([
          getKnowledgeBase(knowledgeId),
          listDocuments(knowledgeId),
          listKnowledgeBaseGroups(knowledgeId),
          listKnowledgeDirectory(knowledgeId),
        ]);
        setKnowledge(nextKnowledge);
        setDirectory(nextDirectory.items);
        setDocuments(nextDocuments.items);
        setLinkedGroups(nextGroups.items);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : t('knowledge.loadFailed'));
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [guideDemo, knowledgeId, t],
  );

  useEffect(() => {
    const task = setTimeout(() => void runInitialRequest(load), 0);
    return () => clearTimeout(task);
  }, [load, runInitialRequest]);
  const focusedOnce = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (focusedOnce.current) void load(false);
      focusedOnce.current = true;
    }, [load]),
  );
  const screenRefresh = useScreenRefresh(() => load(false));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setAppActive(state === 'active');
    });
    return () => subscription.remove();
  }, []);

  const processingDocuments = documents.some(
    (document) =>
      ['queued', 'validating', 'parsing', 'chunking', 'embedding'].includes(document.status.kind) ||
      ['queued', 'running'].includes(document.latestRevision?.status ?? ''),
  );
  useKnowledgeDocumentUpdates({
    active: appActive,
    hasProcessingDocuments: processingDocuments,
    knowledgeBaseId: knowledgeId,
    load,
    setDocuments,
    setError,
    setKnowledge,
  });

  const filteredDocuments = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    const matching = !normalized
      ? documents
      : documents.filter((document) =>
          [
            document.title,
            document.format === 'spreadsheet'
              ? t('knowledgeDetail.spreadsheet')
              : document.format === 'word'
                ? 'Word'
                : 'Markdown',
            statusLabel(document.status, t),
            document.status.kind === 'failed' ? document.status.message : '',
          ].some((value) => value.toLocaleLowerCase().includes(normalized)),
        );
    if (documentFilter === 'all') return matching;
    return matching.filter((document) =>
      documentFilter === 'ready'
        ? document.status.kind === 'ready'
        : documentFilter === 'failed'
          ? document.status.kind === 'failed' || document.latestRevision?.status === 'failed'
          : document.status.kind !== 'ready' && document.status.kind !== 'failed',
    );
  }, [documentFilter, documents, query, t]);
  useEffect(() => {
    let active = true;
    if (!query.trim())
      return () => {
        active = false;
      };
    const timer = setTimeout(() => {
      void listKnowledgeDirectory(knowledgeId, query)
        .then((result) => {
          if (active) setSearchedDirectory({ query, items: result.items });
        })
        .catch(() => {
          if (active) setError(t('collection.loadFailed'));
        });
    }, 180);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [knowledgeId, query, directory, t]);
  const entries: KnowledgeDirectoryEntry[] = [
    ...(query.trim()
      ? searchedDirectory?.query === query
        ? searchedDirectory.items
        : []
      : directory
    ).filter((entry) => entry.kind === 'folder'),
    ...filteredDocuments
      .filter((document) => !document.caseId)
      .map((document) => ({
        kind: 'document' as const,
        documentId: document.id,
        updatedAt: document.updatedAt,
      })),
  ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const renderEntry = (entry: KnowledgeDirectoryEntry) => {
    if (entry.kind === 'folder')
      return (
        <CollectionFolderRow
          key={entry.folder.id}
          folder={entry.folder}
          onMore={() => setActionFolder(entry.folder)}
          onOpen={() => onOpenFolder?.(entry.folder.id, query)}
        />
      );
    const document = documents.find((document) => document.id === entry.documentId);
    if (!document) return null;
    return (
      <DocumentRow
        key={document.id}
        document={document}
        onMore={() => setActionDocument(document)}
        onOpen={() =>
          document.caseId && onOpenCases
            ? onOpenCases(document.caseId)
            : onOpenDocument(document.id)
        }
      />
    );
  };
  const linkedGroupIds = useMemo(
    () => new Set(linkedGroups.map((group) => group.id)),
    [linkedGroups],
  );

  const linkSelectedGroups = useCallback(
    async (groupIds: string[]) => {
      const response = await linkKnowledgeBaseGroups(knowledgeId, { groupIds });
      setLinkedGroups(response.items);
      setKnowledge(await getKnowledgeBase(knowledgeId));
    },
    [knowledgeId],
  );
  const {
    availableGroups,
    confirmLinks,
    linking,
    loadAvailableGroups,
    openGroupPicker,
    pickerError,
    pickerLoading,
    pickerVisible,
    selectedGroupIds,
    setPickerVisible,
    toggleGroup,
  } = useGroupAssociationEditor({ linkGroups: linkSelectedGroups });

  const pickAndUpload = async () => {
    if (guideDemo) return;
    try {
      const selection = await pickDocumentAsync({
        type: [
          'text/markdown',
          'text/plain',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (!selection || selection.canceled) return;
      const asset = selection.assets[0];
      if (!asset) return;
      setUploading(true);
      setError('');
      try {
        const uploaded = await uploadDocument(knowledgeId, asset);
        setDocuments((items) => [
          uploaded.document,
          ...items.filter((item) => item.id !== uploaded.document.id),
        ]);
        setKnowledge(await getKnowledgeBase(knowledgeId));
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : t('knowledgeDetail.uploadFailed'));
      } finally {
        setUploading(false);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('knowledgeDetail.uploadFailed'));
    }
  };

  const retryableDocuments = documents.filter(
    (document) =>
      (document.status.kind === 'failed' && document.status.retryable) ||
      (document.latestRevision?.status === 'failed' && document.latestRevision.error?.retryable),
  );
  const parseAllFailedDocuments = async () => {
    if (guideDemo) return;
    if (!retryableDocuments.length) {
      Alert.alert(t('knowledgeDetail.parseAll'), t('knowledgeDetail.parseAllNone'));
      return;
    }
    Alert.alert(
      t('knowledgeDetail.parseAllConfirm'),
      t('knowledgeDetail.parseAllConfirmBody', { count: retryableDocuments.length }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.confirm'),
          onPress: () => {
            void Promise.allSettled(
              retryableDocuments.map((document) => retryDocument(knowledgeId, document.id)),
            ).then(async (results) => {
              const succeeded = results.filter((result) => result.status === 'fulfilled').length;
              await load(false);
              Alert.alert(
                t('knowledgeDetail.parseAll'),
                t('knowledgeDetail.parseAllSummary', {
                  succeeded,
                  failed: results.length - succeeded,
                }),
              );
            });
          },
        },
      ],
    );
  };

  if (loading && !knowledge) {
    return (
      <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
        <PageHeader onBack={onBack} title={t('knowledgeDetail.title')} />
        <ActivityIndicator
          accessibilityLabel={t('knowledgeDetail.loading')}
          color={colors.ink}
          style={styles.loading}
        />
      </SafeAreaView>
    );
  }

  if (!knowledge) {
    return (
      <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
        <PageHeader onBack={onBack} title={t('knowledgeDetail.title')} />
        <ScrollView
          alwaysBounceVertical
          contentContainerStyle={styles.emptyRefreshContent}
          refreshControl={<ScreenRefreshControl {...screenRefresh} />}
        >
          <EmptyState
            description={t('knowledgeDetail.removed')}
            title={error || t('knowledgeDetail.notFound')}
          />
        </ScrollView>
      </SafeAreaView>
    );
  }

  const renderTabs = () => (
    <View style={styles.tabsSurface}>
      <PageTabs
        activeTab={activeTab}
        onChange={selectTab}
        tabs={detailTabs.map((tab) => ({ key: tab.key, label: t(tab.labelKey) }))}
        testIDPrefix="knowledge-detail-tab"
      />
    </View>
  );
  const renderHero = () => (
    <View style={styles.hero}>
      <Text accessibilityRole="header" style={styles.displayTitle}>
        {knowledge.name}
      </Text>
      <Text numberOfLines={3} style={styles.heroDescription}>
        {knowledge.description || t('knowledge.noDescription')}
      </Text>
      <Text style={styles.heroMeta}>
        {t('knowledge.counts', {
          documents: formatNumber(knowledge.documentCount),
          groups: formatNumber(knowledge.linkedGroupCount),
        })}
      </Text>
      {onOpenCases || onOpenCollection ? (
        <View style={styles.collectionQuickActions}>
          {onOpenCases ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('collection.casesAndReview')}
              onPress={() => onOpenCases()}
              style={styles.collectionQuickAction}
              testID="knowledge-cases-entry"
            >
              <Ionicons name="chatbubbles-outline" size={20} color={textColors.primary} />
              <Text style={styles.collectionQuickText}>{t('collection.casesAndReview')}</Text>
            </Pressable>
          ) : null}
          {onOpenCollection ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('collection.rules')}
              onPress={() => onOpenCollection(linkedGroups.map((group) => group.id))}
              style={styles.collectionQuickAction}
              testID="knowledge-collection-entry"
            >
              <Ionicons name="library-outline" size={20} color={textColors.primary} />
              <Text style={styles.collectionQuickText}>{t('collection.rules')}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
  const fixedActions = guideDemo ? (
    <FixedActionButton
      disabled
      icon="information-circle-outline"
      label={t('knowledgeDetail.upload')}
      onPress={() => undefined}
    />
  ) : activeTab === 'groups' ? (
    <FixedActionButton
      emphasized
      icon="add"
      label={t('knowledgeDetail.linkGroup')}
      onPress={openGroupPicker}
    />
  ) : activeTab === 'files' ? (
    <>
      <FixedActionButton
        disabled={uploading}
        icon="cloud-upload-outline"
        label={uploading ? t('knowledgeDetail.uploading') : t('knowledgeDetail.upload')}
        onPress={() => {
          void pickAndUpload();
        }}
      />
      <FixedActionButton
        emphasized
        icon="chatbubble-ellipses-outline"
        label={t('knowledgeDetail.ask')}
        onPress={() => onAsk?.()}
      />
    </>
  ) : (
    <>
      <FixedActionButton
        icon="analytics-outline"
        label={t('knowledgeDetail.parseAll')}
        onPress={() => void parseAllFailedDocuments()}
      />
      <FixedActionButton
        disabled={uploading}
        emphasized
        icon="cloud-upload-outline"
        label={uploading ? t('knowledgeDetail.uploading') : t('knowledgeDetail.upload')}
        onPress={() => {
          void pickAndUpload();
        }}
      />
    </>
  );

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
      {searchVisible ? (
        <SearchSheet
          appliedQuery={query}
          inputLabel={t('knowledgeDetail.searchInput')}
          onApply={(nextQuery) => {
            setQuery(nextQuery);
            setSearchVisible(false);
            if (nextQuery) selectTab('files');
          }}
          onClose={() => setSearchVisible(false)}
          placeholder={t('knowledgeDetail.searchPlaceholder')}
          subtitle={t('knowledgeDetail.searchSubtitle')}
          title={t('knowledgeDetail.searchTitle')}
          visible
        />
      ) : null}
      <KnowledgeGroupPicker
        allGroups={availableGroups}
        error={pickerError}
        linkedGroupIds={linkedGroupIds}
        loading={pickerLoading}
        onClose={() => {
          if (!linking) setPickerVisible(false);
        }}
        onConfirm={() => {
          void confirmLinks();
        }}
        onRetry={() => {
          void loadAvailableGroups();
        }}
        onToggle={toggleGroup}
        pending={linking}
        selectedGroupIds={selectedGroupIds}
        visible={pickerVisible}
      />
      <KnowledgeGroupSwitchDialog
        group={switchTarget}
        onCancel={() => setSwitchTarget(undefined)}
        onConfirm={() => {
          const target = switchTarget;
          setSwitchTarget(undefined);
          if (target) onSwitchGroup?.(target.id);
        }}
      />
      {actionDocument?.caseId ? (
        <KnowledgeCaseActions
          caseId={actionDocument.caseId}
          onClose={() => setActionDocument(undefined)}
          onChanged={() => load(false)}
          onOpen={(editing) =>
            editing ? onEditCase?.(actionDocument.caseId!) : onOpenCases?.(actionDocument.caseId!)
          }
        />
      ) : null}
      <ActionSheet
        visible={!!actionFolder}
        title={actionFolder?.name ?? ''}
        closeLabel={t('collection.cancel')}
        onClose={() => setActionFolder(undefined)}
        actions={[
          {
            label: t('collection.openFolderAction'),
            icon: 'folder-open-outline',
            onPress: () => {
              if (actionFolder) onOpenFolder?.(actionFolder.id, query);
              setActionFolder(undefined);
            },
          },
          ...(actionFolder?.kind === 'rule'
            ? [
                {
                  label: t('collection.viewRule'),
                  icon: 'options-outline' as const,
                  onPress: () => {
                    if (actionFolder) onViewRule?.(actionFolder);
                    setActionFolder(undefined);
                  },
                },
              ]
            : []),
          ...(actionFolder?.kind === 'legacy'
            ? [
                {
                  label: t('collection.organize'),
                  icon: 'albums-outline' as const,
                  onPress: () => {
                    if (actionFolder) onOrganize?.(actionFolder);
                    setActionFolder(undefined);
                  },
                },
              ]
            : []),
        ]}
      />
      <KnowledgeDocumentEditor
        document={actionDocument?.caseId ? undefined : actionDocument}
        knowledgeId={knowledgeId}
        onClose={() => setActionDocument(undefined)}
        onChanged={() => load()}
        onOpen={() => {
          const target = actionDocument;
          setActionDocument(undefined);
          if (target) onOpenDocument(target.id);
        }}
      />
      <PageHeader
        onBack={onBack}
        onMore={guideDemo ? undefined : onEditBase}
        onSearch={() => setSearchVisible(true)}
        searchLabel={t('knowledgeDetail.searchTitle')}
        title={knowledge.name}
      />
      {guideDemo ? <GuideDemoBanner /> : null}
      <ScrollView
        directionalLockEnabled
        horizontal
        nestedScrollEnabled
        onMomentumScrollEnd={handleMomentumScrollEnd}
        pagingEnabled
        ref={pagerRef}
        showsHorizontalScrollIndicator={false}
        style={styles.pager}
        testID="knowledge-detail-pager"
      >
        <ScrollView
          alwaysBounceVertical
          contentContainerStyle={styles.pageContent}
          refreshControl={<ScreenRefreshControl {...screenRefresh} />}
          showsVerticalScrollIndicator={false}
          stickyHeaderIndices={[1]}
          style={[styles.page, { width: pageWidth }]}
          testID="knowledge-overview-scroll"
        >
          <View ref={overviewTargetRef} collapsable={false}>
            {renderHero()}
          </View>
          {renderTabs()}
          {error ? (
            <Text accessibilityRole="alert" style={styles.failureReason}>
              {error}
            </Text>
          ) : null}
          <View style={styles.overviewContent}>
            <Text style={styles.sectionTitle}>{t('knowledgeDetail.title')}</Text>
            <Text style={styles.recentUpload}>
              {t('knowledgeDetail.recentUpload', {
                date: knowledge.lastUploadedAt
                  ? formatDateTime(knowledge.lastUploadedAt)
                  : t('sources.none'),
              })}
            </Text>
            <View style={styles.metrics}>
              <Metric
                label={t('knowledgeDetail.documentCount')}
                value={formatNumber(knowledge.documentCount)}
              />
              <Metric
                divider
                label={t('knowledgeDetail.totalSize')}
                value={formatBytes(knowledge.totalSizeBytes)}
              />
              <Metric
                divider
                label={t('knowledgeDetail.parsed')}
                value={formatNumber(knowledge.parsedDocumentCount)}
              />
              <Metric
                divider
                label={t('knowledgeDetail.pending')}
                value={formatNumber(knowledge.pendingDocumentCount)}
              />
            </View>
            <View style={styles.infoSection}>
              <Text style={styles.sectionTitle}>{t('knowledge.contentStorage')}</Text>
              <InfoRow
                icon="grid-outline"
                label={t('knowledge.storageLocation')}
                value={
                  knowledge.settings.storageLocation === 'local'
                    ? t('knowledge.local')
                    : t('knowledgeDetail.cloud')
                }
              />
            </View>
            <View style={styles.infoSection}>
              <Text style={styles.sectionTitle}>{t('knowledge.parsing')}</Text>
              <InfoRow
                icon="git-network-outline"
                label={t('knowledge.indexMethod')}
                value={
                  knowledge.settings.indexingMode === 'rag'
                    ? t('knowledge.rag')
                    : t('knowledgeDetail.fullContext')
                }
              />
              <InfoRow
                icon="hardware-chip-outline"
                label={t('knowledge.embeddingModel')}
                value={knowledge.settings.embeddingModel}
              />
              <InfoRow
                icon="hardware-chip-outline"
                label={t('knowledge.rerankModel')}
                value={
                  knowledge.settings.rerankingEnabled
                    ? (knowledge.settings.rerankerModel ?? 'qwen3.7-text-rerank')
                    : t('knowledge.disabled')
                }
              />
            </View>
            <View style={styles.infoSection}>
              <Text style={styles.sectionTitle}>{t('knowledge.processing')}</Text>
              <InfoRow
                icon="analytics-outline"
                label={t('knowledge.parsingMethod')}
                value={
                  knowledge.settings.parsingMode === 'automatic'
                    ? t('knowledge.autoParse')
                    : t('knowledgeDetail.manualParse')
                }
              />
            </View>
            <View style={styles.recentDocuments}>
              <Text style={styles.sectionTitle}>{t('knowledgeDetail.recentDocuments')}</Text>
              {entries.length ? (
                entries.slice(0, 3).map(renderEntry)
              ) : (
                <Text style={styles.emptyText}>{t('knowledgeDetail.noRecentDocuments')}</Text>
              )}
            </View>
          </View>
        </ScrollView>

        <View collapsable={false} ref={filesTargetRef} style={[styles.page, { width: pageWidth }]}>
          <ScrollView
            alwaysBounceVertical
            contentContainerStyle={styles.pageContent}
            keyboardShouldPersistTaps="handled"
            refreshControl={<ScreenRefreshControl {...screenRefresh} />}
            showsVerticalScrollIndicator={false}
            stickyHeaderIndices={[0]}
            style={styles.flexPage}
            testID="knowledge-files-scroll"
          >
            {renderTabs()}
            <View style={styles.stickySearch}>
              <SearchAndFilter
                onChangeText={setQuery}
                onFilterPress={() => setDocumentFilterVisible(true)}
                placeholder={t('knowledgeDetail.searchDocuments')}
                value={query}
              />
            </View>
            {error ? (
              <Text accessibilityRole="alert" style={styles.failureReason}>
                {error}
              </Text>
            ) : null}
            <View style={styles.documentList}>
              {entries.length ? (
                entries.map(renderEntry)
              ) : (
                <Text style={styles.emptyText}>
                  {query.trim()
                    ? t('knowledgeDetail.noDocumentMatch', { query })
                    : t('knowledgeDetail.noDocuments')}
                </Text>
              )}
            </View>
          </ScrollView>
        </View>

        <ScrollView
          alwaysBounceVertical
          contentContainerStyle={styles.pageContent}
          refreshControl={<ScreenRefreshControl {...screenRefresh} />}
          showsVerticalScrollIndicator={false}
          stickyHeaderIndices={[0]}
          style={[styles.page, { width: pageWidth }]}
          testID="knowledge-groups-scroll"
        >
          {renderTabs()}
          <View style={styles.groupList}>
            {linkedGroups.length ? (
              linkedGroups.map((group) => (
                <GroupCard group={group} key={group.id} onSwitch={() => setSwitchTarget(group)} />
              ))
            ) : (
              <EmptyState
                description={t('knowledgeDetail.noGroupsDescription')}
                title={t('knowledgeDetail.noGroups')}
              />
            )}
          </View>
        </ScrollView>
      </ScrollView>
      <ActionSheet
        items={[
          {
            icon: 'list-outline',
            label: t('knowledgeDetail.filterAll'),
            onPress: () => setDocumentFilter('all'),
          },
          {
            icon: 'checkmark-circle-outline',
            label: t('knowledgeDetail.filterReady'),
            onPress: () => setDocumentFilter('ready'),
          },
          {
            icon: 'time-outline',
            label: t('knowledgeDetail.filterPending'),
            onPress: () => setDocumentFilter('pending'),
          },
          {
            icon: 'alert-circle-outline',
            label: t('knowledgeDetail.filterFailed'),
            onPress: () => setDocumentFilter('failed'),
          },
        ]}
        onClose={() => setDocumentFilterVisible(false)}
        title={t('knowledgeDetail.filterAction')}
        visible={documentFilterVisible}
      />
      <View
        collapsable={false}
        ref={uploadTargetRef}
        style={styles.fixedActions}
        testID="knowledge-fixed-actions"
      >
        {fixedActions}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  collectionQuickActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  collectionQuickAction: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radii.default,
    borderColor: colors.divider,
    borderWidth: StyleSheet.hairlineWidth,
  },
  collectionQuickText: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sans,
  },
  safeArea: { backgroundColor: colors.card, flex: 1 },
  emptyRefreshContent: { flexGrow: 1 },
  loading: { marginTop: spacing.xl },
  pager: { flex: 1 },
  page: { flex: 1 },
  flexPage: { flex: 1 },
  pageContent: { flexGrow: 1, paddingBottom: spacing.lg },
  hero: {
    gap: spacing.md,
    padding: spacing.md,
    paddingTop: spacing.lg,
    backgroundColor: colors.background,
  },
  displayTitle: {
    ...typography.contentDisplay,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  heroDescription: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sans,
    minHeight: 40,
  },
  heroMeta: { ...typography.body, color: textColors.secondary, fontFamily: fontFamilies.sans },
  tabsSurface: { backgroundColor: colors.card, zIndex: 1 },
  overviewContent: { gap: spacing.md, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  sectionTitle: {
    ...typography.heading1,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  recentUpload: {
    ...typography.description,
    color: textColors.tertiary,
    fontFamily: fontFamilies.sans,
  },
  metrics: { flexDirection: 'row', paddingVertical: spacing.sm },
  metric: { alignItems: 'center', flex: 1, gap: spacing.sm, minWidth: 0 },
  metricDivider: { borderLeftColor: colors.divider, borderLeftWidth: StyleSheet.hairlineWidth },
  metricValue: {
    ...typography.heading1,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  metricLabel: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  infoSection: { gap: spacing.sm },
  infoRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 32,
  },
  infoLabelRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  infoLabel: { ...typography.body, color: textColors.secondary, fontFamily: fontFamilies.sans },
  infoValue: {
    ...typography.body,
    color: textColors.secondary,
    flexShrink: 1,
    fontFamily: fontFamilies.sans,
    marginLeft: spacing.md,
    textAlign: 'right',
  },
  recentDocuments: { gap: spacing.sm, marginTop: spacing.sm },
  stickySearch: { backgroundColor: colors.card, padding: spacing.md, paddingBottom: spacing.sm },
  documentList: { paddingHorizontal: spacing.md },
  documentRow: {
    alignItems: 'center',
    borderBottomColor: colors.divider,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 92,
    paddingVertical: spacing.base,
  },
  documentOpen: {
    alignItems: 'center',
    alignSelf: 'stretch',
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  documentMain: { flex: 1, gap: spacing.xs },
  documentTitle: {
    ...typography.heading2,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  documentMeta: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  documentUpdated: {
    ...typography.label,
    color: textColors.tertiary,
    fontFamily: fontFamilies.sans,
  },
  failureReason: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    paddingHorizontal: spacing.md,
  },
  documentStatus: { alignItems: 'flex-end', maxWidth: 100 },
  moreButton: { alignItems: 'center', height: 44, justifyContent: 'center', width: 36 },
  emptyText: {
    ...typography.body,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    padding: spacing.lg,
    textAlign: 'center',
  },
  groupList: { gap: spacing.md, padding: spacing.md, backgroundColor: colors.white },
  groupCard: {
    backgroundColor: colors.canvas,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.lg,
    paddingTop: spacing.base,
    paddingBottom: spacing.base,
    paddingLeft: spacing.md,
    paddingRight: spacing.md,
  },
  groupTitleRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  groupTitle: {
    ...typography.heading1,
    color: textColors.primary,
    flex: 1,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  switchButton: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
  groupStats: { flexDirection: 'row' },
  fixedActions: {
    backgroundColor: colors.card,
    borderTopColor: colors.divider,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  disabled: { opacity: 0.45 },
  pressed: { backgroundColor: colors.background },
});
