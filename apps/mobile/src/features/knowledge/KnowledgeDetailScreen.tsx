/** Implements swipeable library-file and linked-group pages with independent scrolling. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

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
import {
  getKnowledgeBase,
  type DocumentStatus,
  type KnowledgeDocument,
  type LinkedGroup,
} from './mockData';

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
  text: '文本',
} as const;

function statusLabel(status: DocumentStatus) {
  switch (status.kind) {
    case 'complete':
      return '解析完成';
    case 'waiting':
      return '待解析';
    case 'uploading':
      return '上传中';
    case 'parsing':
      return `解析中 ${status.progress}%`;
    case 'failed':
      return '解析失败';
  }
}

function DocumentRow({
  document,
  onOpen,
}: {
  document: KnowledgeDocument;
  onOpen: () => void;
}) {
  const enabled = document.status.kind === 'complete';
  const content = (
    <>
      <DocumentFormatIcon format={document.format} size={40} />
      <View style={styles.documentMain}>
        <Text numberOfLines={1} style={styles.documentTitle}>
          {document.title}
        </Text>
        <Text style={styles.documentMeta}>
          {formatLabels[document.format]} · {document.size}
        </Text>
        <Text style={styles.documentUpdated}>更新于 {document.updatedAt}</Text>
      </View>
      <View style={styles.documentStatus}>
        <DocumentStatusView document={document} />
      </View>
      <Pressable
        accessibilityLabel={`${document.title}更多操作`}
        accessibilityRole="button"
        hitSlop={8}
        onPress={(event) => {
          event?.stopPropagation();
          showComingSoon('文件更多操作');
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

function GroupCard({ group }: { group: LinkedGroup }) {
  const stats = [
    { label: '分析数', value: group.analysisCount },
    { label: '音频数', value: group.audioCount },
    { label: '知识库', value: group.knowledgeCount },
    { label: '数据源', value: group.dataSourceCount },
  ];

  return (
    <View style={styles.groupCard}>
      <View style={styles.groupTitleRow}>
        <Text style={styles.groupTitle}>{group.name}</Text>
        <Pressable
          accessibilityLabel={`解除关联：${group.name}`}
          accessibilityRole="button"
          onPress={() => showComingSoon('解除分组关联')}
          style={({ pressed }) => [styles.moreButton, pressed && styles.pressed]}
        >
          <Ionicons color={colors.secondary} name="unlink-outline" size={24} />
        </Pressable>
      </View>
      <View style={styles.groupStats}>
        {stats.map((stat, index) => (
          <View
            key={stat.label}
            style={[styles.groupStat, index > 0 && styles.groupStatDivider]}
          >
            <Text style={styles.groupStatValue}>{stat.value}</Text>
            <Text style={styles.groupStatLabel}>{stat.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function KnowledgeDetailScreen({
  knowledgeId,
  onBack,
  onOpenDocument,
}: {
  knowledgeId: string;
  onBack: () => void;
  onOpenDocument: (documentId: string) => void;
}) {
  const knowledge = getKnowledgeBase(knowledgeId);
  const [activeTab, setActiveTab] = useState<DetailTab>('files');
  const [query, setQuery] = useState('');
  const { handleMomentumScrollEnd, pageWidth, pagerRef, selectTab } =
    useSwipePager({
      activeTab,
      onTabChange: setActiveTab,
      tabs: detailTabKeys,
    });

  const filteredDocuments = useMemo(() => {
    if (!knowledge) {
      return [];
    }
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) {
      return knowledge.documents;
    }
    return knowledge.documents.filter((document) =>
      [
        document.title,
        formatLabels[document.format],
        statusLabel(document.status),
      ].some((value) => value.toLocaleLowerCase().includes(normalized)),
    );
  }, [knowledge, query]);

  if (!knowledge) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <PageHeader onBack={onBack} title="知识库详情" />
        <EmptyState
          description="该知识库可能已被移除，请返回知识库列表。"
          title="未找到知识库"
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
              {knowledge.documentCount} 份文档 · 关联 {knowledge.linkedGroupCount} 个分组
            </Text>
          </View>
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
            label="上传文档"
            onPress={() => showComingSoon('上传文档')}
          />
        </ScrollView>

        <ScrollView
          contentContainerStyle={styles.pageContent}
          showsVerticalScrollIndicator={false}
          style={{ width: pageWidth }}
        >
          <PageTabs activeTab={activeTab} onChange={selectTab} tabs={detailTabs} />
          <View style={styles.groupList}>
            {knowledge.linkedGroups.map((group) => (
              <GroupCard key={group.id} group={group} />
            ))}
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
