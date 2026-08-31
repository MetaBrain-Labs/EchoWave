/**
 * 知识库详情页面。
 *
 * 组合知识库概览、文档列表和关联分组三个可滑动页面，并协调上传、关联和跨页切组。
 *
 * Responsibilities:
 * - 加载知识库概览、文档和关联分组事实。
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
import { PageHeader } from '@/shared/ui/PageHeader';
import { PageTabs } from '@/shared/ui/PageTabs';
import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';
import { DocumentFormatIcon, DocumentStatusView } from '../components/DocumentUi';
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
  { key: 'overview', label: '概览' },
  { key: 'files', label: '库文件' },
  { key: 'groups', label: '关联分组' },
] as const;
type DetailTab = (typeof detailTabs)[number]['key'];
const detailTabKeys = detailTabs.map((tab) => tab.key);

const formatLabels = {
  markdown: 'Markdown',
  word: 'Word',
  spreadsheet: '表格',
} as const;

function formatBytes(sizeBytes: number) {
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  if (sizeBytes < 1024 * 1024 * 1024) return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(sizeBytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function statusLabel(status: DocumentStatus) {
  switch (status.kind) {
    case 'ready':
      return '解析完成';
    case 'queued':
      return '待解析';
    case 'validating':
      return '校验中';
    case 'parsing':
    case 'chunking':
      return '解析中';
    case 'embedding':
      return `向量化 ${status.progress}%`;
    case 'failed':
      return '解析失败';
    case 'deleting':
      return '删除中';
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
  onOpen,
  onRetry,
}: {
  document: KnowledgeDocument;
  onOpen: () => void;
  onRetry: () => void;
}) {
  const enabled = document.status.kind === 'ready';
  const requiresReupload =
    document.status.kind === 'failed' &&
    document.status.code === 'EMBEDDING_MODEL_MIGRATION_REQUIRED';
  const content = (
    <>
      <DocumentFormatIcon format={document.format} size={40} />
      <View style={styles.documentMain}>
        <Text numberOfLines={1} style={styles.documentTitle}>
          {document.title}
        </Text>
        <Text style={styles.documentMeta}>
          {formatLabels[document.format]} · {formatBytes(document.sizeBytes)}
        </Text>
        <Text style={styles.documentUpdated}>
          更新于 {new Date(document.updatedAt).toLocaleDateString()}
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
      <Pressable
        accessibilityLabel={
          document.status.kind === 'failed'
            ? requiresReupload
              ? `重新上传文档：${document.title}`
              : `重试文档：${document.title}`
            : `${document.title}更多操作`
        }
        accessibilityRole="button"
        hitSlop={8}
        onPress={(event) => {
          event?.stopPropagation();
          if (document.status.kind === 'failed') onRetry();
          else showComingSoon('文件更多操作');
        }}
        style={({ pressed }) => [styles.moreButton, pressed && styles.pressed]}
      >
        <Ionicons color={colors.ink} name="ellipsis-vertical" size={24} />
      </Pressable>
    </>
  );
  if (!enabled) return <View style={styles.documentRow}>{content}</View>;
  return (
    <Pressable
      accessibilityLabel={`打开文件：${document.title}`}
      accessibilityRole="button"
      onPress={onOpen}
      style={({ pressed }) => [styles.documentRow, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

function GroupCard({ group, onSwitch }: { group: GroupSummary; onSwitch: () => void }) {
  return (
    <View style={styles.groupCard}>
      <View style={styles.groupTitleRow}>
        <Text numberOfLines={1} style={styles.groupTitle}>
          {group.name}
        </Text>
        <Pressable
          accessibilityLabel={`切换至分组：${group.name}`}
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
        <Metric label="分析数" value={`${group.metrics.analysisCount}`} />
        <Metric divider label="音频数" value={`${group.metrics.audioCount}`} />
        <Metric divider label="知识库" value={`${group.metrics.knowledgeCount}`} />
        <Metric divider label="数据源" value={`${group.metrics.sourceCount}`} />
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
  const [knowledge, setKnowledge] = useState<KnowledgeBaseDetail>();
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [linkedGroups, setLinkedGroups] = useState<GroupSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [appActive, setAppActive] = useState(AppState.currentState !== 'background');
  const [activeTab, setActiveTab] = useState<DetailTab>('overview');
  const [query, setQuery] = useState('');
  const [switchTarget, setSwitchTarget] = useState<GroupSummary>();
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
        setError(reason instanceof Error ? reason.message : '知识库加载失败。');
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [knowledgeId],
  );

  useEffect(() => {
    const task = setTimeout(() => void load(), 0);
    return () => clearTimeout(task);
  }, [load]);

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
      [document.title, formatLabels[document.format], statusLabel(document.status)].some((value) =>
        value.toLocaleLowerCase().includes(normalized),
      ),
    );
  }, [documents, query]);
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

  const retry = (document: KnowledgeDocument) => {
    if (
      document.status.kind === 'failed' &&
      document.status.code === 'EMBEDDING_MODEL_MIGRATION_REQUIRED'
    ) {
      void pickAndUpload();
      return;
    }
    void retryDocument(knowledgeId, document.id)
      .then((current) =>
        setDocuments((items) => items.map((item) => (item.id === current.id ? current : item))),
      )
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : '重试失败，请重新上传文件。'),
      );
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
      setError(reason instanceof Error ? reason.message : '文档上传失败。');
    } finally {
      setUploading(false);
    }
  };

  if (loading && !knowledge) {
    return (
      <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
        <PageHeader onBack={onBack} onMore={() => showComingSoon('更多操作')} title="知识库详情" />
        <ActivityIndicator
          accessibilityLabel="正在加载知识库详情"
          color={colors.ink}
          style={styles.loading}
        />
      </SafeAreaView>
    );
  }

  if (!knowledge) {
    return (
      <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
        <PageHeader onBack={onBack} onMore={() => showComingSoon('更多操作')} title="知识库详情" />
        <EmptyState
          description="该知识库可能已被移除，请返回知识库列表。"
          title={error || '未找到知识库'}
        />
      </SafeAreaView>
    );
  }

  const renderTabs = () => (
    <View style={styles.tabsSurface}>
      <PageTabs activeTab={activeTab} onChange={selectTab} tabs={detailTabs} />
    </View>
  );
  const renderHero = () => (
    <View style={styles.hero}>
      <Text accessibilityRole="header" style={styles.displayTitle}>
        {knowledge.name}
      </Text>
      <Text numberOfLines={3} style={styles.heroDescription}>
        {knowledge.description || '暂无描述'}
      </Text>
      <Text style={styles.heroMeta}>
        {knowledge.documentCount} 份文档 · 关联 {knowledge.linkedGroupCount} 个分组
      </Text>
    </View>
  );
  const fixedActions =
    activeTab === 'groups' ? (
      <FixedActionButton emphasized icon="add" label="关联新分组" onPress={openGroupPicker} />
    ) : activeTab === 'files' ? (
      <>
        <FixedActionButton
          disabled={uploading}
          icon="cloud-upload-outline"
          label={uploading ? '正在上传并解析…' : '上传文档'}
          onPress={() => {
            void pickAndUpload();
          }}
        />
        <FixedActionButton
          emphasized
          icon="chatbubble-ellipses-outline"
          label="问知识库"
          onPress={() => onAsk?.()}
        />
      </>
    ) : (
      <>
        <FixedActionButton
          icon="analytics-outline"
          label="全部解析"
          onPress={() => showComingSoon('全部解析')}
        />
        <FixedActionButton
          disabled={uploading}
          emphasized
          icon="cloud-upload-outline"
          label={uploading ? '正在上传并解析…' : '上传文档'}
          onPress={() => {
            void pickAndUpload();
          }}
        />
      </>
    );

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
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
      <PageHeader
        onBack={onBack}
        onMore={() => showComingSoon('知识库更多操作')}
        onSearch={() => showComingSoon('知识库详情搜索')}
        searchLabel="搜索知识库内容"
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
          contentContainerStyle={styles.pageContent}
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
            <Text style={styles.sectionTitle}>知识库详情</Text>
            <Text style={styles.recentUpload}>
              最近上传　
              {knowledge.lastUploadedAt
                ? new Date(knowledge.lastUploadedAt).toLocaleString('zh-CN', { hour12: false })
                : '暂无'}
            </Text>
            <View style={styles.metrics}>
              <Metric label="文档数" value={`${knowledge.documentCount}`} />
              <Metric divider label="总大小" value={formatBytes(knowledge.totalSizeBytes)} />
              <Metric divider label="已解析" value={`${knowledge.parsedDocumentCount}`} />
              <Metric divider label="待处理" value={`${knowledge.pendingDocumentCount}`} />
            </View>
            <View style={styles.infoSection}>
              <Text style={styles.sectionTitle}>内容存储</Text>
              <InfoRow
                icon="grid-outline"
                label="存储位置"
                value={knowledge.settings.storageLocation === 'local' ? '本地' : '云端'}
              />
            </View>
            <View style={styles.infoSection}>
              <Text style={styles.sectionTitle}>知识解析</Text>
              <InfoRow
                icon="git-network-outline"
                label="索引方式"
                value={
                  knowledge.settings.indexingMode === 'rag'
                    ? '检索增强（RAG）'
                    : '上下文注入（Full Context）'
                }
              />
              <InfoRow
                icon="hardware-chip-outline"
                label="嵌入模型"
                value={knowledge.settings.embeddingModel}
              />
              <InfoRow
                icon="hardware-chip-outline"
                label="重排序模型"
                value={knowledge.settings.rerankerModel ?? '未启用'}
              />
            </View>
            <View style={styles.infoSection}>
              <Text style={styles.sectionTitle}>解析处理</Text>
              <InfoRow
                icon="analytics-outline"
                label="解析方式"
                value={knowledge.settings.parsingMode === 'automatic' ? '自动解析' : '手动解析'}
              />
            </View>
            <View style={styles.recentDocuments}>
              <Text style={styles.sectionTitle}>近期文档</Text>
              {documents.length ? (
                documents
                  .slice(0, 3)
                  .map((document) => (
                    <DocumentRow
                      key={document.id}
                      document={document}
                      onOpen={() => onOpenDocument(document.id)}
                      onRetry={() => retry(document)}
                    />
                  ))
              ) : (
                <Text style={styles.emptyText}>暂无近期文档</Text>
              )}
            </View>
          </View>
        </ScrollView>

        <ScrollView
          contentContainerStyle={styles.pageContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          stickyHeaderIndices={[0]}
          style={[styles.page, { width: pageWidth }]}
          testID="knowledge-files-scroll"
        >
          {renderTabs()}
          <View style={styles.stickySearch}>
            <SearchAndFilter onChangeText={setQuery} placeholder="搜索文档..." value={query} />
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
                  onOpen={() => onOpenDocument(document.id)}
                  onRetry={() => retry(document)}
                />
              ))
            ) : (
              <Text style={styles.emptyText}>{query.trim() ? '没有匹配的文档' : '暂无文档'}</Text>
            )}
          </View>
        </ScrollView>

        <ScrollView
          contentContainerStyle={styles.pageContent}
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
              <EmptyState description="使用下方按钮将知识库关联到已有分组。" title="暂无关联分组" />
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
    gap: spacing.sm,
    minHeight: 92,
    paddingVertical: spacing.base,
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
