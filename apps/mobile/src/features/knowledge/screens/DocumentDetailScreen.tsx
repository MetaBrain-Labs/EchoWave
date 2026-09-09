/**
 * 知识文档详情页面。
 *
 * 展示服务器解析后的文档状态、文本块、原文预览与会话级重点标记。
 *
 * Responsibilities:
 * - 加载并渲染文档解析与原文两个可滑动分页。
 * - 协调搜索、重点标记、全屏预览与文本块导航。
 *
 * Notes:
 * - 文档与解析结果始终以服务器响应为准，重新解析暂不调用失败任务专用接口。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type { KnowledgeDocumentDetail, SupportedLanguage } from '@echowave/contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, type TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PageHeader } from '@/shared/ui/PageHeader';
import { PageTabs } from '@/shared/ui/PageTabs';

import { useSwipePager } from '@/shared/hooks/useSwipePager';
import { useScreenRefresh } from '@/shared/hooks/useScreenRefresh';
import { useInitialRequestLoading } from '@/shared/navigation/NavigationLoadingProvider';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import { ScreenRefreshControl } from '@/shared/ui/ScreenRefreshControl';
import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';
import { getDocument } from '../apiClient';
import { ActionButton, DocumentFormatIcon } from '../components/DocumentUi';
import { EmptyState } from '../components/EmptyState';
import { SearchAndFilter } from '../components/SearchAndFilter';
import { showComingSoon } from '../components/feedback';
import { toggleImportantBlock, useImportantBlocks } from '../importantBlocks';

const tabKeys = ['parsed', 'original'] as const;
type Tab = (typeof tabKeys)[number];
type PreviewMode = 'preview' | 'code';

function formatBytes(sizeBytes: number, language: SupportedLanguage) {
  const formatter = new Intl.NumberFormat(language, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  if (sizeBytes < 1024 * 1024) return `${formatter.format(sizeBytes / 1024)} KB`;
  return `${formatter.format(sizeBytes / 1024 / 1024)} MB`;
}

/** 加载并展示指定知识文档的解析结果与原文预览。 */
export function DocumentDetailScreen({
  documentId,
  initialBlockId,
  initialTab = 'parsed',
  knowledgeId,
  onBack,
  onOpenBlock,
}: {
  documentId: string;
  initialBlockId?: string;
  initialTab?: Tab;
  knowledgeId: string;
  onBack: () => void;
  onOpenBlock: (blockId: string) => void;
}) {
  const { formatDateTime, formatNumber, language, t } = useAppLanguage();
  const tabs = [
    { key: 'parsed', label: t('documentDetail.parsedTab') },
    { key: 'original', label: t('documentDetail.originalTab') },
  ] as const;
  const [document, setDocument] = useState<KnowledgeDocumentDetail>();
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const [previewMode, setPreviewMode] = useState<PreviewMode>('preview');
  const [fullScreen, setFullScreen] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const searchInputRef = useRef<TextInput>(null);
  const importantBlocks = useImportantBlocks();
  const runInitialRequest = useInitialRequestLoading();
  const { handleMomentumScrollEnd, pageWidth, pagerRef, selectTab } = useSwipePager({
    activeTab,
    onTabChange: setActiveTab,
    tabs: tabKeys,
  });

  const load = useCallback(async () => {
    try {
      setDocument(await getDocument(knowledgeId, documentId));
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('documentDetail.loadFailed'));
    }
  }, [documentId, knowledgeId, t]);
  const screenRefresh = useScreenRefresh(load);

  useEffect(() => {
    void runInitialRequest(load);
  }, [load, runInitialRequest]);

  const chunks = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return document?.chunks ?? [];
    return (document?.chunks ?? []).filter((chunk) =>
      `${chunk.title}\n${chunk.content}\n${chunk.vectorId}`
        .toLocaleLowerCase()
        .includes(normalized),
    );
  }, [document, query]);

  if (!document) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <PageHeader
          onBack={onBack}
          onMore={() => showComingSoon(t('common.moreActions'))}
          title={t('documentDetail.title')}
        />
        <ScrollView
          alwaysBounceVertical
          contentContainerStyle={styles.emptyRefreshContent}
          refreshControl={<ScreenRefreshControl {...screenRefresh} />}
        >
          <EmptyState
            description={error || t('documentDetail.loadingDescription')}
            title={error ? t('common.loadFailed') : t('common.loading')}
          />
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (fullScreen) {
    return (
      <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
        <DocumentPreview
          fullScreen
          mode={previewMode}
          onModeChange={setPreviewMode}
          onRefresh={screenRefresh.onRefresh}
          onToggleFullScreen={() => setFullScreen(false)}
          previewText={document.previewText}
          refreshing={screenRefresh.refreshing}
          title={document.title}
        />
      </SafeAreaView>
    );
  }

  const parsedAt = document.status.kind === 'ready' ? document.status.parsedAt : document.updatedAt;
  const totalCharacters = document.chunks.reduce((sum, chunk) => sum + chunk.charCount, 0);
  const reparse = () => showComingSoon(t('documentDetail.reparseSuccess'));

  return (
    <SafeAreaView style={styles.safeAreaWhite}>
      <PageHeader
        leading={<DocumentFormatIcon format={document.format} size={28} />}
        onMore={() => showComingSoon(t('common.moreActions'))}
        onBack={onBack}
        onSearch={() => {
          if (activeTab === 'parsed') searchInputRef.current?.focus();
          else showComingSoon(t('documentDetail.originalSearch'));
        }}
        searchLabel={
          activeTab === 'parsed'
            ? t('documentDetail.chunkSearch')
            : t('documentDetail.searchOriginal')
        }
        title={document.title}
      />
      <PageTabs
        activeTab={activeTab}
        onChange={selectTab}
        tabs={tabs}
        testIDPrefix="document-detail-tab"
      />
      <ScrollView
        directionalLockEnabled
        horizontal
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
        onMomentumScrollEnd={handleMomentumScrollEnd}
        pagingEnabled
        ref={pagerRef}
        showsHorizontalScrollIndicator={false}
        style={styles.pager}
        testID="document-detail-pager"
      >
        <View style={[styles.page, { width: pageWidth }]}>
          <ScrollView
            alwaysBounceVertical
            contentContainerStyle={styles.pageContent}
            keyboardShouldPersistTaps="handled"
            refreshControl={<ScreenRefreshControl {...screenRefresh} />}
            showsVerticalScrollIndicator={false}
            stickyHeaderIndices={[1]}
            testID="document-parsed-scroll"
          >
            <View style={styles.parsedOverview}>
              <Text style={styles.sectionTitle}>{t('documentDetail.parseStatus')}</Text>
              <Text style={styles.timestamp}>
                {t('documentDetail.parsedAt', { date: formatDateTime(parsedAt) })}
              </Text>
              <View style={styles.metrics}>
                <Metric
                  label={t('documentDetail.chunks')}
                  value={formatNumber(document.chunks.length)}
                />
                <Metric
                  divider
                  label={t('documentDetail.characters')}
                  value={formatNumber(totalCharacters)}
                />
                <Metric
                  divider
                  label={t('documentDetail.originalSize')}
                  value={formatBytes(document.sizeBytes, language)}
                />
                <Metric
                  divider
                  label={t('documentDetail.vectors')}
                  value={formatNumber(document.vectorCount)}
                />
              </View>
              <Text style={styles.sectionTitle}>
                {t('documentDetail.chunkList', {
                  count: formatNumber(document.chunks.length),
                })}
              </Text>
            </View>
            <View style={styles.stickySearch}>
              <SearchAndFilter
                inputRef={searchInputRef}
                onChangeText={setQuery}
                placeholder={t('documentDetail.searchParsed')}
                value={query}
              />
            </View>
            <View style={styles.chunkList}>
              {chunks.map((chunk) => {
                const important = importantBlocks.has(chunk.id);
                return (
                  <Pressable
                    key={chunk.id}
                    accessibilityLabel={t('documentDetail.openChunk', { title: chunk.title })}
                    accessibilityRole="button"
                    onPress={() => onOpenBlock(chunk.id)}
                    style={({ pressed }) => [
                      styles.chunk,
                      chunk.id === initialBlockId && styles.highlight,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={styles.chunkHeader}>
                      <Text style={styles.chunkTitle}>
                        {t('documentDetail.chunkTitle', {
                          index: formatNumber(chunk.index),
                          title: chunk.title || t('documentDetail.body'),
                        })}
                      </Text>
                      <Pressable
                        accessibilityLabel={t('documentDetail.markImportant', {
                          action: important ? t('documentDetail.unset') : t('documentDetail.set'),
                          title: chunk.title,
                        })}
                        accessibilityRole="button"
                        accessibilityState={{ selected: important }}
                        hitSlop={8}
                        onPress={(event) => {
                          event?.stopPropagation();
                          toggleImportantBlock(chunk.id);
                        }}
                        style={({ pressed }) => [
                          styles.inlineIconButton,
                          pressed && styles.pressed,
                        ]}
                      >
                        <Ionicons
                          color={colors.ink}
                          name={important ? 'star' : 'star-outline'}
                          size={typography.heading2.lineHeight}
                        />
                      </Pressable>
                    </View>
                    <View style={styles.chunkBodyRow}>
                      <Text numberOfLines={2} style={styles.chunkBody}>
                        {chunk.content}
                      </Text>
                      <Ionicons
                        color={colors.muted}
                        name="chevron-forward"
                        size={typography.heading1.lineHeight}
                      />
                    </View>
                    <View style={styles.chunkMetaRow}>
                      <Text style={styles.meta}>
                        {t('documentDetail.vectorId', { id: chunk.vectorId.slice(0, 8) })}
                      </Text>
                      <Text style={styles.meta}>
                        {t('documentDetail.characterCount', {
                          count: formatNumber(chunk.charCount),
                        })}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
              {!chunks.length ? (
                <Text style={styles.emptyText}>{t('documentDetail.noChunks')}</Text>
              ) : null}
            </View>
          </ScrollView>
          <FixedAction label={t('documentDetail.reparse')} onPress={reparse} />
        </View>

        <View style={[styles.page, { width: pageWidth }]}>
          <ScrollView
            alwaysBounceVertical
            contentContainerStyle={styles.originalContent}
            refreshControl={<ScreenRefreshControl {...screenRefresh} />}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.documentMetaRow}>
              <DocumentFormatIcon format={document.format} size={40} />
              <View style={styles.documentMetaMain}>
                <Text numberOfLines={1} style={styles.documentTitle}>
                  {document.title}
                </Text>
                <Text style={styles.meta}>
                  {document.format === 'spreadsheet'
                    ? t('knowledgeDetail.spreadsheet')
                    : document.format === 'word'
                      ? 'Word'
                      : 'Markdown'}{' '}
                  · {formatBytes(document.sizeBytes, language)}
                </Text>
                <Text style={styles.timestamp}>
                  {t('documentDetail.updated', { date: formatDateTime(document.updatedAt) })}
                </Text>
              </View>
              <Pressable
                accessibilityLabel={t('documentDetail.downloadAccessibility')}
                accessibilityRole="button"
                onPress={() => showComingSoon(t('documentDetail.downloadAction'))}
                style={({ pressed }) => [styles.downloadButton, pressed && styles.pressed]}
              >
                <Ionicons
                  color={colors.secondary}
                  name="cloud-download-outline"
                  size={typography.heading1.lineHeight}
                />
                <Text style={styles.downloadText}>{t('documentDetail.download')}</Text>
              </Pressable>
            </View>
            <View style={styles.divider} />
            <DocumentPreview
              mode={previewMode}
              onModeChange={setPreviewMode}
              onRefresh={screenRefresh.onRefresh}
              onToggleFullScreen={() => setFullScreen(true)}
              previewText={document.previewText}
              refreshing={screenRefresh.refreshing}
              title={document.title}
            />
          </ScrollView>
          <FixedAction label={t('documentDetail.reparse')} onPress={reparse} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Metric({
  divider,
  label,
  value,
}: {
  divider?: boolean;
  label: string;
  value: string | number;
}) {
  return (
    <View style={[styles.metric, divider && styles.metricDivider]}>
      <Text numberOfLines={1} style={styles.metricValue}>
        {value}
      </Text>
      <Text style={styles.meta}>{label}</Text>
    </View>
  );
}

function FixedAction({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <View style={styles.fixedAction} testID="document-fixed-action">
      <ActionButton icon="refresh" label={label} onPress={onPress} />
    </View>
  );
}

function DocumentPreview({
  fullScreen = false,
  mode,
  onModeChange,
  onRefresh,
  onToggleFullScreen,
  previewText,
  refreshing,
  title,
}: {
  fullScreen?: boolean;
  mode: PreviewMode;
  onModeChange: (mode: PreviewMode) => void;
  onRefresh: () => void;
  onToggleFullScreen: () => void;
  previewText: string;
  refreshing: boolean;
  title: string;
}) {
  const { t } = useAppLanguage();
  const content = previewText || t('documentDetail.noPreview');
  return (
    <View
      style={[styles.previewCard, fullScreen && styles.fullScreenPreview]}
      testID={fullScreen ? 'document-fullscreen-preview' : 'document-preview'}
    >
      <View style={styles.previewToolbar}>
        <View accessibilityRole="tablist" style={styles.previewTabs}>
          {(['preview', 'code'] as const).map((item) => {
            const selected = mode === item;
            return (
              <Pressable
                key={item}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => onModeChange(item)}
                style={styles.previewTab}
              >
                <Text style={[styles.previewTabText, selected && styles.previewTabTextActive]}>
                  {item === 'preview' ? t('documentDetail.preview') : t('documentDetail.code')}
                </Text>
                <View style={[styles.previewTabLine, selected && styles.previewTabLineActive]} />
              </Pressable>
            );
          })}
        </View>
        <Pressable
          accessibilityLabel={t('documentDetail.zoomAccessibility')}
          accessibilityRole="button"
          onPress={() => showComingSoon(t('documentDetail.zoomAction'))}
          style={styles.toolbarButton}
        >
          <Text style={styles.toolbarText}>100%</Text>
          <Ionicons color={colors.ink} name="chevron-down" size={typography.heading5.lineHeight} />
        </Pressable>
        <Pressable
          accessibilityLabel={
            fullScreen ? t('documentDetail.exitFullscreen') : t('documentDetail.fullscreen')
          }
          accessibilityRole="button"
          onPress={onToggleFullScreen}
          style={styles.toolbarButton}
        >
          <Ionicons
            color={colors.ink}
            name={fullScreen ? 'contract-outline' : 'expand-outline'}
            size={typography.heading1.lineHeight}
          />
        </Pressable>
      </View>
      {fullScreen ? (
        <ScrollView
          alwaysBounceVertical
          contentContainerStyle={styles.previewContent}
          refreshControl={<ScreenRefreshControl onRefresh={onRefresh} refreshing={refreshing} />}
          showsVerticalScrollIndicator={false}
        >
          {mode === 'preview' ? (
            <Text accessibilityRole="header" style={styles.previewTitle}>
              {title}
            </Text>
          ) : null}
          <Text selectable style={[styles.previewText, mode === 'code' && styles.codeText]}>
            {content}
          </Text>
        </ScrollView>
      ) : (
        <View style={styles.previewContent}>
          {mode === 'preview' ? (
            <Text accessibilityRole="header" style={styles.previewTitle}>
              {title}
            </Text>
          ) : null}
          <Text selectable style={[styles.previewText, mode === 'code' && styles.codeText]}>
            {content}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.card, flex: 1 },
  safeAreaWhite: { backgroundColor: colors.white, flex: 1 },
  emptyRefreshContent: { flexGrow: 1 },
  pager: { flex: 1 },
  page: { flex: 1, height: '100%' },
  pageContent: { paddingBottom: spacing.lg },
  parsedOverview: { gap: spacing.lg, padding: spacing.md },
  sectionTitle: {
    ...typography.heading1,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  timestamp: {
    ...typography.description,
    color: textColors.tertiary,
    fontFamily: fontFamilies.sans,
  },
  metrics: { flexDirection: 'row', paddingVertical: spacing.md },
  metric: { alignItems: 'center', flex: 1, gap: spacing.sm, minWidth: 0 },
  metricDivider: { borderLeftColor: colors.divider, borderLeftWidth: StyleSheet.hairlineWidth },
  metricValue: {
    ...typography.heading2,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  stickySearch: {
    backgroundColor: colors.card,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    zIndex: 2,
  },
  chunkList: { gap: spacing.sm, paddingHorizontal: spacing.md },
  chunk: {
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  highlight: { backgroundColor: colors.successSurface, borderColor: colors.ink },
  chunkHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  chunkTitle: {
    ...typography.heading2,
    color: textColors.primary,
    flex: 1,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  inlineIconButton: { alignItems: 'center', height: 32, justifyContent: 'center', width: 32 },
  chunkBodyRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  chunkBody: {
    ...typography.body,
    color: textColors.secondary,
    flex: 1,
    fontFamily: fontFamilies.sans,
  },
  chunkMetaRow: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'space-between' },
  meta: { ...typography.description, color: textColors.secondary, fontFamily: fontFamilies.sans },
  emptyText: {
    ...typography.body,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    paddingVertical: spacing.xl,
    textAlign: 'center',
  },
  fixedAction: {
    backgroundColor: colors.card,
    borderTopColor: colors.divider,
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
  },
  originalContent: { gap: spacing.md, padding: spacing.md },
  documentMetaRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  documentMetaMain: { flex: 1, gap: spacing.xs },
  documentTitle: {
    ...typography.heading2,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  downloadButton: {
    alignItems: 'center',
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 48,
    minWidth: 48,
  },
  downloadText: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  divider: { backgroundColor: colors.divider, height: StyleSheet.hairlineWidth },
  previewCard: {
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    overflow: 'hidden',
  },
  fullScreenPreview: { flex: 1, margin: spacing.sm },
  previewToolbar: {
    alignItems: 'center',
    borderBottomColor: colors.divider,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 52,
    paddingHorizontal: spacing.md,
  },
  previewTabs: { flex: 1, flexDirection: 'row', gap: spacing.lg },
  previewTab: { justifyContent: 'flex-end' },
  previewTabText: {
    ...typography.heading5,
    color: textColors.secondary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
    paddingBottom: spacing.xs,
  },
  previewTabTextActive: { ...typography.heading4, color: textColors.primary },
  previewTabLine: { backgroundColor: 'transparent', height: 2 },
  previewTabLineActive: { backgroundColor: colors.ink },
  toolbarButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
  },
  toolbarText: { ...typography.body, color: textColors.primary, fontFamily: fontFamilies.sans },
  previewContent: { flexGrow: 1, gap: spacing.md, padding: spacing.md },
  previewTitle: {
    ...typography.contentDisplay,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  previewText: { ...typography.body, color: textColors.primary, fontFamily: fontFamilies.sans },
  codeText: { color: textColors.secondary },
  pressed: { backgroundColor: colors.background },
});
