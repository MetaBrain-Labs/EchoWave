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
import type {
  DocumentChunk,
  KnowledgeDocumentDetail,
  SupportedLanguage,
} from '@echowave/contracts';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  type LayoutChangeEvent,
  type TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PageHeader } from '@/shared/ui/PageHeader';
import { PageTabs } from '@/shared/ui/PageTabs';

import { useSwipePager } from '@/shared/hooks/useSwipePager';
import { useScreenRefresh } from '@/shared/hooks/useScreenRefresh';
import { useInitialRequestLoading } from '@/shared/navigation/NavigationLoadingProvider';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import { useStarterTourTarget } from '@/shared/onboarding/StarterTourContext';
import { ScreenRefreshControl } from '@/shared/ui/ScreenRefreshControl';
import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';
import { downloadDocumentSource, getDocument } from '../apiClient';
import { ActionSheet } from '@/shared/ui/ActionSheet';
import { ActionButton, DocumentFormatIcon } from '../components/DocumentUi';
import { KnowledgeDocumentEditor } from '../components/KnowledgeDocumentEditor';
import { EmptyState } from '../components/EmptyState';
import { SearchAndFilter } from '../components/SearchAndFilter';
import { toggleImportantBlock, useImportantBlocks } from '../importantBlocks';
import { GuideDemoBanner } from '../components/GuideDemoBanner';
import { guideDemoDocument } from '../guideDemoData';

const tabKeys = ['parsed', 'original'] as const;
type Tab = (typeof tabKeys)[number];
type PreviewMode = 'preview' | 'code';
type ChunkFilter = 'all' | 'important';

function formatBytes(sizeBytes: number, language: SupportedLanguage) {
  const formatter = new Intl.NumberFormat(language, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  if (sizeBytes < 1024 * 1024) return `${formatter.format(sizeBytes / 1024)} KB`;
  return `${formatter.format(sizeBytes / 1024 / 1024)} MB`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 在原文预览中标记搜索命中，保持原始正文可选择和复制。 */
function HighlightedText({ content, query }: { content: string; query: string }): ReactNode {
  const normalized = query.trim();
  if (!normalized) return content;
  const parts = content.split(new RegExp(`(${escapeRegExp(normalized)})`, 'ig'));
  return parts.map((part, index) =>
    part.toLocaleLowerCase() === normalized.toLocaleLowerCase() ? (
      <Text key={`${part}-${index}`} style={styles.searchHighlight}>
        {part}
      </Text>
    ) : (
      part
    ),
  );
}

function findOriginalTarget(previewText: string, chunk?: DocumentChunk) {
  if (!chunk || !previewText) return undefined;
  const previewLower = previewText.toLocaleLowerCase();
  const candidates = [chunk.sourceExcerpt, chunk.content]
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const matched = candidates.find((value) => previewLower.includes(value.toLocaleLowerCase()));
  if (!matched) return undefined;
  const lineQuery =
    matched
      .split(/\r?\n/)
      .find((line) => line.trim())
      ?.trim() ?? matched;
  return { lineQuery };
}

/** 加载并展示指定知识文档的解析结果与原文预览。 */
export function DocumentDetailScreen({
  guideDemo = false,
  documentId,
  initialBlockId,
  initialTab = 'parsed',
  knowledgeId,
  onBack,
  onOpenBlock,
}: {
  guideDemo?: boolean;
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
  const [editingDocument, setEditingDocument] = useState(false);
  const [document, setDocument] = useState<KnowledgeDocumentDetail>();
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const [previewMode, setPreviewMode] = useState<PreviewMode>('preview');
  const [fullScreen, setFullScreen] = useState(false);
  const [query, setQuery] = useState('');
  const [originalQuery, setOriginalQuery] = useState('');
  const [chunkFilter, setChunkFilter] = useState<ChunkFilter>('all');
  const [chunkFilterVisible, setChunkFilterVisible] = useState(false);
  const [error, setError] = useState('');
  const searchInputRef = useRef<TextInput>(null);
  const originalSearchInputRef = useRef<TextInput>(null);
  const originalScrollRef = useRef<ScrollView>(null);
  const originalPreviewYRef = useRef<number | undefined>(undefined);
  const originalTargetYRef = useRef<number | undefined>(undefined);
  const [originalLayoutVersion, setOriginalLayoutVersion] = useState(0);
  const originalLocatedRef = useRef(false);
  const importantBlocks = useImportantBlocks();
  const runInitialRequest = useInitialRequestLoading();
  const { handleMomentumScrollEnd, pageWidth, pagerRef, selectTab } = useSwipePager({
    activeTab,
    onTabChange: setActiveTab,
    tabs: tabKeys,
  });
  const documentStatusTargetRef = useStarterTourTarget('knowledge-document-status');
  const blockListTargetRef = useStarterTourTarget('document-block-list');

  const load = useCallback(async () => {
    try {
      setDocument(guideDemo ? guideDemoDocument : await getDocument(knowledgeId, documentId));
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('documentDetail.loadFailed'));
    }
  }, [documentId, guideDemo, knowledgeId, t]);
  const screenRefresh = useScreenRefresh(load);

  useEffect(() => {
    void runInitialRequest(load);
  }, [load, runInitialRequest]);

  useEffect(() => {
    if (!['queued', 'running'].includes(document?.latestRevision?.status ?? '')) return;
    const timer = setInterval(() => void load(), 5_000);
    return () => clearInterval(timer);
  }, [document?.latestRevision?.status, load]);

  const chunks = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    const matching = !normalized
      ? (document?.chunks ?? [])
      : (document?.chunks ?? []).filter((chunk) =>
          `${chunk.title}\n${chunk.content}\n${chunk.vectorId}`
            .toLocaleLowerCase()
            .includes(normalized),
        );
    return chunkFilter === 'important'
      ? matching.filter((chunk) => importantBlocks.has(chunk.id))
      : matching;
  }, [chunkFilter, document, importantBlocks, query]);

  const originalTarget = useMemo(
    () =>
      findOriginalTarget(
        document?.previewText ?? '',
        document?.chunks.find((chunk) => chunk.id === initialBlockId),
      ),
    [document, initialBlockId],
  );
  const originalTargetKey = originalTarget?.lineQuery ?? '';
  useEffect(() => {
    originalLocatedRef.current = false;
    originalPreviewYRef.current = undefined;
    originalTargetYRef.current = undefined;
  }, [originalTargetKey]);

  const handleOriginalPreviewLayout = useCallback((y: number) => {
    originalPreviewYRef.current = y;
    setOriginalLayoutVersion((version) => version + 1);
  }, []);
  const handleOriginalTargetLayout = useCallback((y: number) => {
    originalTargetYRef.current = y;
    setOriginalLayoutVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    if (
      activeTab !== 'original' ||
      !originalTarget ||
      originalPreviewYRef.current === undefined ||
      originalTargetYRef.current === undefined ||
      originalLocatedRef.current
    ) {
      return undefined;
    }
    const previewY = originalPreviewYRef.current;
    const targetY = originalTargetYRef.current;
    const frame = requestAnimationFrame(() => {
      originalScrollRef.current?.scrollTo({
        animated: true,
        y: Math.max(0, previewY + targetY - spacing.lg),
      });
      originalLocatedRef.current = true;
    });
    return () => cancelAnimationFrame(frame);
  }, [activeTab, originalLayoutVersion, originalTarget]);

  if (!document) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <PageHeader
          onBack={onBack}
          onMore={() => setEditingDocument(true)}
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
          highlightQuery={originalQuery}
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
  const reparse = () => setEditingDocument(true);

  return (
    <SafeAreaView style={styles.safeAreaWhite}>
      <KnowledgeDocumentEditor
        document={editingDocument ? document : undefined}
        knowledgeId={knowledgeId}
        onClose={() => setEditingDocument(false)}
        onOpen={() => setEditingDocument(false)}
        onChanged={load}
        onDeleted={onBack}
      />
      {document.activeRevisionId &&
      document.latestRevision &&
      document.activeRevisionId !== document.latestRevision.id ? (
        <Text style={styles.revisionNotice}>
          {t('knowledgeEdit.oldActive')} {document.latestRevision.title} ·{' '}
          {document.latestRevision.progress}%
          {document.latestRevision.error ? ` · ${document.latestRevision.error.message}` : ''}
        </Text>
      ) : null}
      <PageHeader
        leading={<DocumentFormatIcon format={document.format} size={28} />}
        onMore={guideDemo ? undefined : () => setEditingDocument(true)}
        onBack={onBack}
        onSearch={() => {
          if (activeTab === 'parsed') searchInputRef.current?.focus();
          else originalSearchInputRef.current?.focus();
        }}
        searchLabel={
          activeTab === 'parsed'
            ? t('documentDetail.chunkSearch')
            : t('documentDetail.searchOriginal')
        }
        title={document.title}
      />
      {guideDemo ? <GuideDemoBanner /> : null}
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
        contentOffset={{ x: Math.max(tabKeys.indexOf(activeTab), 0) * pageWidth, y: 0 }}
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
            <View ref={documentStatusTargetRef} collapsable={false} style={styles.parsedOverview}>
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
                onFilterPress={() => setChunkFilterVisible(true)}
                placeholder={t('documentDetail.searchParsed')}
                value={query}
              />
            </View>
            <View ref={blockListTargetRef} collapsable={false} style={styles.chunkList}>
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
            ref={originalScrollRef}
            showsVerticalScrollIndicator={false}
            testID="document-original-scroll"
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
                onPress={() => {
                  void downloadDocumentSource(knowledgeId, document.id, document.title).catch(
                    (reason) => {
                      Alert.alert(
                        t('documentDetail.downloadFailed'),
                        reason instanceof Error
                          ? reason.message
                          : t('documentDetail.downloadFailed'),
                      );
                    },
                  );
                }}
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
            <SearchAndFilter
              inputRef={originalSearchInputRef}
              onChangeText={setOriginalQuery}
              placeholder={t('documentDetail.searchOriginal')}
              value={originalQuery}
            />
            <View style={styles.divider} />
            <DocumentPreview
              mode={previewMode}
              onModeChange={setPreviewMode}
              onPreviewLayout={handleOriginalPreviewLayout}
              onRefresh={screenRefresh.onRefresh}
              onTargetLayout={handleOriginalTargetLayout}
              onToggleFullScreen={() => setFullScreen(true)}
              previewText={document.previewText}
              refreshing={screenRefresh.refreshing}
              highlightQuery={originalQuery || originalTarget?.lineQuery || ''}
              targetQuery={originalTarget?.lineQuery}
              title={document.title}
            />
          </ScrollView>
          <FixedAction label={t('documentDetail.reparse')} onPress={reparse} />
        </View>
      </ScrollView>
      <ActionSheet
        items={[
          {
            icon: 'list-outline',
            label: t('documentDetail.filterAll'),
            onPress: () => setChunkFilter('all'),
          },
          {
            icon: 'star-outline',
            label: t('documentDetail.filterImportant'),
            onPress: () => setChunkFilter('important'),
          },
        ]}
        onClose={() => setChunkFilterVisible(false)}
        title={t('documentDetail.filterAction')}
        visible={chunkFilterVisible}
      />
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

function PreviewTextContent({
  content,
  fontSize,
  highlightQuery,
  mode,
  onLayout,
  onTargetLayout,
  targetQuery,
}: {
  content: string;
  fontSize: number;
  highlightQuery: string;
  mode: PreviewMode;
  onLayout?: (event: LayoutChangeEvent) => void;
  onTargetLayout?: (event: LayoutChangeEvent) => void;
  targetQuery?: string;
}) {
  const textStyle = [styles.previewText, { fontSize }, mode === 'code' && styles.codeText];
  const lines = content.split(/\r?\n/);
  const normalizedTarget = targetQuery?.trim().toLocaleLowerCase();
  const targetLineIndex = normalizedTarget
    ? lines.findIndex((line) => line.toLocaleLowerCase().includes(normalizedTarget))
    : -1;

  if (targetLineIndex < 0) {
    return (
      <Text onLayout={onLayout} selectable style={textStyle}>
        <HighlightedText content={content} query={highlightQuery} />
      </Text>
    );
  }

  return (
    <View onLayout={onLayout}>
      {lines.map((line, index) => (
        <Text
          key={`${index}-${line}`}
          onLayout={index === targetLineIndex ? onTargetLayout : undefined}
          selectable
          style={textStyle}
          testID={index === targetLineIndex ? 'document-original-target-line' : undefined}
        >
          <HighlightedText content={line || ' '} query={highlightQuery} />
        </Text>
      ))}
    </View>
  );
}

function DocumentPreview({
  fullScreen = false,
  highlightQuery,
  mode,
  onModeChange,
  onPreviewLayout,
  onTargetLayout,
  onRefresh,
  onToggleFullScreen,
  previewText,
  refreshing,
  targetQuery,
  title,
}: {
  fullScreen?: boolean;
  highlightQuery: string;
  mode: PreviewMode;
  onModeChange: (mode: PreviewMode) => void;
  onPreviewLayout?: (y: number) => void;
  onTargetLayout?: (y: number) => void;
  onRefresh: () => void;
  onToggleFullScreen: () => void;
  previewText: string;
  refreshing: boolean;
  targetQuery?: string;
  title: string;
}) {
  const { t } = useAppLanguage();
  const [zoom, setZoom] = useState(100);
  const [zoomVisible, setZoomVisible] = useState(false);
  const previewContentYRef = useRef(0);
  const textBlockYRef = useRef(0);
  const content = previewText || t('documentDetail.noPreview');
  const reportTargetLayout = useCallback(
    (event: LayoutChangeEvent) => {
      onTargetLayout?.(
        previewContentYRef.current + textBlockYRef.current + event.nativeEvent.layout.y,
      );
    },
    [onTargetLayout],
  );
  const textContent = (
    <PreviewTextContent
      content={content}
      fontSize={(typography.body.fontSize ?? 16) * (zoom / 100)}
      highlightQuery={highlightQuery}
      mode={mode}
      onLayout={(event) => {
        textBlockYRef.current = event.nativeEvent.layout.y;
      }}
      onTargetLayout={reportTargetLayout}
      targetQuery={targetQuery}
    />
  );
  return (
    <View
      onLayout={
        onPreviewLayout ? (event) => onPreviewLayout(event.nativeEvent.layout.y) : undefined
      }
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
          onPress={() => setZoomVisible(true)}
          style={styles.toolbarButton}
        >
          <Text style={styles.toolbarText}>{zoom}%</Text>
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
          {textContent}
        </ScrollView>
      ) : (
        <View
          onLayout={(event) => {
            previewContentYRef.current = event.nativeEvent.layout.y;
          }}
          style={styles.previewContent}
        >
          {mode === 'preview' ? (
            <Text accessibilityRole="header" style={styles.previewTitle}>
              {title}
            </Text>
          ) : null}
          {textContent}
        </View>
      )}
      <ActionSheet
        items={[70, 85, 100, 115, 130].map((value) => ({
          label: `${value}%`,
          onPress: () => setZoom(value),
        }))}
        onClose={() => setZoomVisible(false)}
        title={t('documentDetail.zoomAction')}
        visible={zoomVisible}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.card, flex: 1 },
  safeAreaWhite: { backgroundColor: colors.white, flex: 1 },
  emptyRefreshContent: { flexGrow: 1 },
  revisionNotice: { ...typography.body, color: textColors.secondary, padding: spacing.md },
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
  searchHighlight: { backgroundColor: colors.successSurface, color: textColors.primary },
  codeText: { color: textColors.secondary },
  pressed: { backgroundColor: colors.background },
});
