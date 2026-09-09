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
import Ionicons from '@expo/vector-icons/Ionicons';
import * as DocumentPicker from 'expo-document-picker';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type {
  DocumentStatus,
  GroupSummary,
  KnowledgeBaseDetail,
  KnowledgeDocument,
} from '@echowave/contracts';

import { linkKnowledgeBaseGroups, listKnowledgeBaseGroups } from '@/shared/api/knowledgeBasesApi';
import { useSwipePager } from '@/shared/hooks/useSwipePager';
import { useGroupAssociationEditor } from '@/shared/hooks/useGroupAssociationEditor';
import { useScreenRefresh } from '@/shared/hooks/useScreenRefresh';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import { PageHeader } from '@/shared/ui/PageHeader';
import { PageTabs } from '@/shared/ui/PageTabs';
import { SearchSheet } from '@/shared/ui/SearchSheet';
import { ScreenRefreshControl } from '@/shared/ui/ScreenRefreshControl';
import { useInitialRequestLoading } from '@/shared/navigation/NavigationLoadingProvider';
import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';
import { DocumentFormatIcon, DocumentStatusView } from '../components/DocumentUi';
import { KnowledgeDocumentActions } from '../components/KnowledgeDocumentActions';
import { EmptyState } from '../components/EmptyState';
import {
  KnowledgeGroupPicker,
  KnowledgeGroupSwitchDialog,
} from '../components/KnowledgeGroupDialogs';
import { SearchAndFilter } from '../components/SearchAndFilter';
import { showComingSoon } from '../components/feedback';
import { getKnowledgeBase, listDocuments, retryDocument, uploadDocument } from '../apiClient';
import { useKnowledgeDocumentUpdates } from '../hooks/useKnowledgeDocumentUpdates';

const detailTabs = [
  { key: 'overview', labelKey: 'knowledgeDetail.tabOverview' },
  { key: 'files', labelKey: 'knowledgeDetail.tabFiles' },
  { key: 'groups', labelKey: 'knowledgeDetail.tabGroups' },
] as const;
type DetailTab = (typeof detailTabs)[number]['key'];
const detailTabKeys = detailTabs.map((tab) => tab.key);

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

function DocumentRow({
  document,
  onMore,
  onOpen,
}: {
  document: KnowledgeDocument;
  onMore: () => void;
  onOpen: () => void;
}) {
  const { formatDateTime, t } = useAppLanguage();
  const enabled = document.status.kind === 'ready';
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

function FixedActionButton({
  disabled = false,
  emphasized = false,
  icon,
  label,
  onPress,
}: {
  disabled?: boolean;
  emphasized?: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        emphasized && styles.emphasizedAction,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Ionicons
        color={emphasized ? colors.white : colors.ink}
        name={icon}
        size={typography.body.lineHeight}
      />
      <Text style={[styles.actionText, emphasized && styles.emphasizedActionText]}>{label}</Text>
    </Pressable>
  );
}

/** 加载并展示知识库详情，协调上传、关联、切组与问答入口。 */
export function KnowledgeDetailScreen({
  knowledgeId,
  onBack,
  onAsk,
  onOpenDocument,
  onSwitchGroup,
}: {
  knowledgeId: string;
  onBack: () => void;
  onAsk?: () => void;
  onOpenDocument: (documentId: string) => void;
  onSwitchGroup?: (groupId: string) => void;
}) {
  const { formatDateTime, formatNumber, t } = useAppLanguage();
  const [knowledge, setKnowledge] = useState<KnowledgeBaseDetail>();
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [linkedGroups, setLinkedGroups] = useState<GroupSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [appActive, setAppActive] = useState(AppState.currentState !== 'background');
  const [activeTab, setActiveTab] = useState<DetailTab>('overview');
  const [query, setQuery] = useState('');
  const [searchVisible, setSearchVisible] = useState(false);
  const [switchTarget, setSwitchTarget] = useState<GroupSummary>();
  const [actionDocument, setActionDocument] = useState<KnowledgeDocument>();
  const [pendingDocumentId, setPendingDocumentId] = useState<string>();
  const runInitialRequest = useInitialRequestLoading();
  const { handleMomentumScrollEnd, pageWidth, pagerRef, selectTab } = useSwipePager({
    activeTab,
    onTabChange: setActiveTab,
    tabs: detailTabKeys,
  });

  const load = useCallback(
    async (showLoading = true) => {
      if (showLoading) setLoading(true);
      setError('');
      try {
        const [nextKnowledge, nextDocuments, nextGroups] = await Promise.all([
          getKnowledgeBase(knowledgeId),
          listDocuments(knowledgeId),
          listKnowledgeBaseGroups(knowledgeId),
        ]);
        setKnowledge(nextKnowledge);
        setDocuments(nextDocuments.items);
        setLinkedGroups(nextGroups.items);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : t('knowledge.loadFailed'));
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [knowledgeId, t],
  );

  useEffect(() => {
    const task = setTimeout(() => void runInitialRequest(load), 0);
    return () => clearTimeout(task);
  }, [load, runInitialRequest]);
  const screenRefresh = useScreenRefresh(() => load(false));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setAppActive(state === 'active');
    });
    return () => subscription.remove();
  }, []);

  const processingDocuments = documents.some((document) =>
    ['queued', 'validating', 'parsing', 'chunking', 'embedding'].includes(document.status.kind),
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
    if (!normalized) return documents;
    return documents.filter((document) =>
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
  }, [documents, query, t]);
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

  const retry = async (document: KnowledgeDocument) => {
    if (pendingDocumentId) return;
    setPendingDocumentId(document.id);
    setError('');
    try {
      const current = await retryDocument(knowledgeId, document.id);
      setDocuments((items) => items.map((item) => (item.id === current.id ? current : item)));
      setActionDocument(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('knowledgeDetail.retryFailed'));
    } finally {
      setPendingDocumentId(undefined);
    }
  };

  const pickAndUpload = async () => {
    const selection = await DocumentPicker.getDocumentAsync({
      type: [
        'text/markdown',
        'text/plain',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (selection.canceled) return;
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
  };

  const confirmRetry = (document: KnowledgeDocument) => {
    Alert.alert(
      t('knowledgeDetail.confirmRetry'),
      t('knowledgeDetail.confirmRetryBody', { title: document.title }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('knowledgeDetail.retryParsing'), onPress: () => void retry(document) },
      ],
    );
  };
  const confirmReupload = (document: KnowledgeDocument) => {
    Alert.alert(
      t('knowledgeDetail.confirmReupload'),
      t('knowledgeDetail.confirmReuploadBody', { title: document.title }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('knowledgeDetail.selectFile'),
          onPress: () => {
            setActionDocument(undefined);
            void pickAndUpload();
          },
        },
      ],
    );
  };

  if (loading && !knowledge) {
    return (
      <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
        <PageHeader
          onBack={onBack}
          onMore={() => showComingSoon(t('common.moreActions'))}
          title={t('knowledgeDetail.title')}
        />
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
        <PageHeader
          onBack={onBack}
          onMore={() => showComingSoon(t('common.moreActions'))}
          title={t('knowledgeDetail.title')}
        />
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
    </View>
  );
  const fixedActions =
    activeTab === 'groups' ? (
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
          onPress={() => showComingSoon(t('knowledgeDetail.parseAll'))}
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
      <KnowledgeDocumentActions
        document={actionDocument}
        onClose={() => {
          if (!pendingDocumentId) setActionDocument(undefined);
        }}
        onOpen={() => {
          const target = actionDocument;
          setActionDocument(undefined);
          if (target) onOpenDocument(target.id);
        }}
        onReupload={() => {
          if (actionDocument) confirmReupload(actionDocument);
        }}
        onRetry={() => {
          if (actionDocument) confirmRetry(actionDocument);
        }}
        onShowFailure={() => {
          if (actionDocument?.status.kind === 'failed') {
            Alert.alert(
              t('knowledgeDetail.failureReason'),
              t('knowledgeDetail.errorCode', {
                message: actionDocument.status.message,
                code: actionDocument.status.code,
              }),
            );
          }
        }}
        pending={pendingDocumentId === actionDocument?.id || uploading}
      />
      <PageHeader
        onBack={onBack}
        onMore={() => showComingSoon(t('knowledgeDetail.moreActions'))}
        onSearch={() => setSearchVisible(true)}
        searchLabel={t('knowledgeDetail.searchTitle')}
        title={knowledge.name}
      />
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
          {renderHero()}
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
                value={knowledge.settings.rerankerModel ?? t('knowledge.disabled')}
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
              {documents.length ? (
                documents
                  .slice(0, 3)
                  .map((document) => (
                    <DocumentRow
                      key={document.id}
                      document={document}
                      onMore={() => setActionDocument(document)}
                      onOpen={() => onOpenDocument(document.id)}
                    />
                  ))
              ) : (
                <Text style={styles.emptyText}>{t('knowledgeDetail.noRecentDocuments')}</Text>
              )}
            </View>
          </View>
        </ScrollView>

        <ScrollView
          alwaysBounceVertical
          contentContainerStyle={styles.pageContent}
          keyboardShouldPersistTaps="handled"
          refreshControl={<ScreenRefreshControl {...screenRefresh} />}
          showsVerticalScrollIndicator={false}
          stickyHeaderIndices={[0]}
          style={[styles.page, { width: pageWidth }]}
          testID="knowledge-files-scroll"
        >
          {renderTabs()}
          <View style={styles.stickySearch}>
            <SearchAndFilter
              onChangeText={setQuery}
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
            {filteredDocuments.length ? (
              filteredDocuments.map((document) => (
                <DocumentRow
                  key={document.id}
                  document={document}
                  onMore={() => setActionDocument(document)}
                  onOpen={() => onOpenDocument(document.id)}
                />
              ))
            ) : (
              <Text style={styles.emptyText}>
                {query.trim()
                  ? t('knowledgeDetail.noDocumentMatch', { query })
                  : t('knowledgeDetail.noDocuments')}
              </Text>
            )}
          </View>
        </ScrollView>

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
      <View style={styles.fixedActions} testID="knowledge-fixed-actions">
        {fixedActions}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.card, flex: 1 },
  emptyRefreshContent: { flexGrow: 1 },
  loading: { marginTop: spacing.xl },
  pager: { flex: 1 },
  page: { flex: 1 },
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
  actionButton: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 56,
    paddingHorizontal: spacing.md,
  },
  emphasizedAction: { backgroundColor: colors.ink, borderColor: colors.ink },
  actionText: {
    ...typography.body,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  emphasizedActionText: { color: colors.white },
  disabled: { opacity: 0.45 },
  pressed: { backgroundColor: colors.background },
});
