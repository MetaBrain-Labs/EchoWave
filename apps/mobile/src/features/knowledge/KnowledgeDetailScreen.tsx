/** Implements swipeable library-file and linked-group pages with independent scrolling. */
import Ionicons from '@expo/vector-icons/Ionicons';
import * as DocumentPicker from 'expo-document-picker';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { DocumentStatus, KnowledgeBaseDetail, KnowledgeDocument } from '@echowave/contracts';

import { useSwipePager } from '../../components/useSwipePager';
import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '../../theme/tokens';
import {
  ActionButton,
  DocumentFormatIcon,
  DocumentStatusView,
  EmptyState,
  PageHeader,
  PageTabs,
  SearchAndFilter,
  showComingSoon,
} from './KnowledgeShared';
import { getDocument, getKnowledgeBase, listDocuments, retryDocument, uploadDocument } from './apiClient';

const detailTabs = [
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
  const content = (
    <>
      <DocumentFormatIcon format={document.format} size={40} />
      <View style={styles.documentMain}>
        <Text numberOfLines={1} style={styles.documentTitle}>
          {document.title}
        </Text>
        <Text style={styles.documentMeta}>
          {formatLabels[document.format]} · {(document.sizeBytes / 1024).toFixed(1)} KB
        </Text>
        <Text style={styles.documentUpdated}>更新于 {new Date(document.updatedAt).toLocaleDateString()}</Text>
        {document.status.kind === 'failed' ? (
          <Text numberOfLines={2} style={styles.failureReason}>{document.status.message}</Text>
        ) : null}
      </View>
      <View style={styles.documentStatus}>
        <DocumentStatusView document={document} />
      </View>
      <Pressable
        accessibilityLabel={document.status.kind === 'failed' ? `重试文档：${document.title}` : `${document.title}更多操作`}
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

  if (!enabled) {
    return <View style={styles.documentRow}>{content}</View>;
  }

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

export function KnowledgeDetailScreen({
  knowledgeId,
  onBack,
  onAsk,
  onOpenDocument,
}: {
  knowledgeId: string;
  onBack: () => void;
  onAsk?: () => void;
  onOpenDocument: (documentId: string) => void;
}) {
  const [knowledge, setKnowledge] = useState<KnowledgeBaseDetail>();
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [activeTab, setActiveTab] = useState<DetailTab>('files');
  const [query, setQuery] = useState('');
  const { handleMomentumScrollEnd, pageWidth, pagerRef, selectTab } =
    useSwipePager({
      activeTab,
      onTabChange: setActiveTab,
      tabs: detailTabKeys,
    });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [nextKnowledge, nextDocuments] = await Promise.all([
        getKnowledgeBase(knowledgeId),
        listDocuments(knowledgeId),
      ]);
      setKnowledge(nextKnowledge);
      setDocuments(nextDocuments.items);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '知识库加载失败。');
    } finally {
      setLoading(false);
    }
  }, [knowledgeId]);
  useEffect(() => {
    const task = setTimeout(() => void load(), 0);
    return () => clearTimeout(task);
  }, [load]);

  const filteredDocuments = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) {
      return documents;
    }
    return documents.filter((document) =>
      [
        document.title,
        formatLabels[document.format],
        statusLabel(document.status),
      ].some((value) => value.toLocaleLowerCase().includes(normalized)),
    );
  }, [documents, query]);

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
      await load();
      let delay = 2_000;
      for (let attempt = 0; attempt < 60; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        const current = await getDocument(knowledgeId, uploaded.document.id);
        setDocuments((items) => items.map((item) => item.id === current.id ? current : item));
        if (current.status.kind === 'ready' || current.status.kind === 'failed') break;
        if (attempt >= 4) delay = 5_000;
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '文档上传失败。');
    } finally {
      setUploading(false);
    }
  };

  if (loading && !knowledge) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <PageHeader onBack={onBack} title="知识库详情" />
        <EmptyState description="正在从服务器读取知识库与文档。" title="正在加载" />
      </SafeAreaView>
    );
  }

  if (!knowledge) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <PageHeader onBack={onBack} title="知识库详情" />
        <EmptyState
          description="该知识库可能已被移除，请返回知识库列表。"
          title={error || "未找到知识库"}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <PageHeader onBack={onBack} title={knowledge.name} />
      <ScrollView
        horizontal
        keyboardShouldPersistTaps="handled"
        onMomentumScrollEnd={handleMomentumScrollEnd}
        pagingEnabled
        ref={pagerRef}
        showsHorizontalScrollIndicator={false}
        style={styles.pager}
        testID="knowledge-detail-pager"
      >
        <ScrollView
          contentContainerStyle={styles.pageContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          stickyHeaderIndices={[1]}
          style={{ width: pageWidth }}
          testID="knowledge-files-scroll"
        >
          <View style={styles.hero}>
            <Text accessibilityRole="header" style={styles.displayTitle}>
              {knowledge.name}
            </Text>
            <Text numberOfLines={3} style={styles.heroDescription}>
              {knowledge.description}
            </Text>
            <Text style={styles.heroMeta}>
              {documents.length} 份文档 · 关联 {knowledge.linkedGroupCount} 个分组
            </Text>
          </View>
          {error ? <Text accessibilityRole="alert" style={styles.failureReason}>{error}</Text> : null}
          <View style={styles.stickySearch}>
            <SearchAndFilter
              onChangeText={setQuery}
              placeholder="搜索文档..."
              value={query}
            />
          </View>
          <PageTabs activeTab={activeTab} onChange={selectTab} tabs={detailTabs} />
          <View style={styles.documentList}>
            {filteredDocuments.length ? (
              filteredDocuments.map((document) => (
                <DocumentRow
                  key={document.id}
                  document={document}
                  onOpen={() => onOpenDocument(document.id)}
                  onRetry={() => {
                    void retryDocument(knowledgeId, document.id)
                      .then((current) => setDocuments((items) => items.map((item) => item.id === current.id ? current : item)))
                      .catch((reason) => setError(reason instanceof Error ? reason.message : '重试失败，请重新上传文件。'));
                  }}
                />
              ))
            ) : (
              <View style={styles.inlineEmpty}>
                <Text style={styles.emptyText}>没有匹配的文档</Text>
              </View>
            )}
          </View>
          <ActionButton
            icon="cloud-upload-outline"
            label={uploading ? "正在上传并解析…" : "上传文档"}
            onPress={() => { if (!uploading) void pickAndUpload(); }}
          />
          <ActionButton icon="chatbubble-ellipses-outline" label="问知识库" onPress={() => onAsk?.()} />
        </ScrollView>

        <ScrollView
          contentContainerStyle={styles.pageContent}
          showsVerticalScrollIndicator={false}
          style={{ width: pageWidth }}
        >
          <PageTabs activeTab={activeTab} onChange={selectTab} tabs={detailTabs} />
          <View style={styles.groupList}>
            <EmptyState description="首期暂不提供分组关联数据。" title="暂无关联分组" />
          </View>
          <ActionButton
            icon="add"
            label="关联新分组"
            onPress={() => showComingSoon('关联新分组')}
          />
        </ScrollView>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.card,
    flex: 1,
  },
  pager: {
    flex: 1,
  },
  pageContent: {
    gap: spacing.md,
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  hero: {
    gap: spacing.md,
    paddingBottom: spacing.md,
    paddingTop: spacing.lg,
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
  },
  heroMeta: {
    ...typography.body,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  stickySearch: {
    backgroundColor: colors.card,
    paddingVertical: spacing.sm,
    zIndex: 1,
  },
  documentList: {
    marginHorizontal: -spacing.md,
  },
  documentRow: {
    alignItems: 'center',
    borderBottomColor: colors.divider,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 92,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.base,
  },
  documentMain: {
    flex: 1,
    gap: spacing.xs,
  },
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
    color: '#b42318',
    fontFamily: fontFamilies.sans,
  },
  documentStatus: {
    alignItems: 'flex-end',
    maxWidth: 100,
  },
  moreButton: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    width: 36,
  },
  pressed: {
    backgroundColor: colors.background,
  },
  inlineEmpty: {
    alignItems: 'center',
    minHeight: 120,
    justifyContent: 'center',
  },
  emptyText: {
    ...typography.body,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  groupList: {
    gap: spacing.md,
  },
  groupCard: {
    backgroundColor: colors.canvas,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.lg,
    padding: spacing.lg,
  },
  groupTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  groupTitle: {
    ...typography.heading1,
    color: textColors.primary,
    flex: 1,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  groupStats: {
    flexDirection: 'row',
  },
  groupStat: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.sm,
  },
  groupStatDivider: {
    borderLeftColor: colors.divider,
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  groupStatValue: {
    ...typography.heading1,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  groupStatLabel: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
});
