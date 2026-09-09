/**
 * 文档块详情页面。
 *
 * 展示服务器权威的文档块正文、原文预览、来源定位和相邻块上下文。
 *
 * Responsibilities:
 * - 加载并渲染指定文档块及其相邻块。
 * - 提供定位原文、会话级重点标记与前后块导航。
 *
 * Notes:
 * - 不在客户端修改正文事实，复制能力在未引入剪贴板依赖前使用占位反馈。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type { DocumentChunk, KnowledgeDocumentDetail } from '@echowave/contracts';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PageHeader } from '@/shared/ui/PageHeader';
import { ScreenRefreshControl } from '@/shared/ui/ScreenRefreshControl';
import { useScreenRefresh } from '@/shared/hooks/useScreenRefresh';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import { useInitialRequestLoading } from '@/shared/navigation/NavigationLoadingProvider';

import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';
import { getDocument } from '../apiClient';
import { EmptyState } from '../components/EmptyState';
import { showComingSoon } from '../components/feedback';
import { toggleImportantBlock, useImportantBlocks } from '../importantBlocks';

function locatorText(chunk: DocumentChunk, t: ReturnType<typeof useAppLanguage>['t']) {
  const locator = chunk.locator;
  if (locator.kind === 'spreadsheet')
    return t('blockDetail.sheetLocation', {
      sheet: locator.sheet,
      start: locator.rowStart,
      end: locator.rowEnd,
    });
  if (locator.kind === 'word')
    return t('blockDetail.paragraphLocation', {
      heading: locator.headingPath.join(' / ') || t('documentDetail.body'),
      start: locator.paragraphStart,
      end: locator.paragraphEnd,
    });
  return t('blockDetail.lineLocation', {
    heading: locator.headingPath.join(' / ') || t('documentDetail.body'),
    start: locator.lineStart,
    end: locator.lineEnd,
  });
}

/** 加载并展示指定文档块、原文来源及相邻块导航。 */
export function BlockDetailScreen({
  blockId,
  documentId,
  knowledgeId,
  onBack,
  onLocateOriginal,
  onNavigateBlock,
}: {
  blockId: string;
  documentId: string;
  knowledgeId: string;
  onBack: () => void;
  onLocateOriginal: (blockId: string) => void;
  onNavigateBlock: (blockId: string) => void;
}) {
  const { formatNumber, t } = useAppLanguage();
  const [document, setDocument] = useState<KnowledgeDocumentDetail>();
  const [error, setError] = useState('');
  const importantBlocks = useImportantBlocks();
  const runInitialRequest = useInitialRequestLoading();

  const load = useCallback(async () => {
    try {
      setDocument(await getDocument(knowledgeId, documentId));
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('blockDetail.loadFailed'));
    }
  }, [documentId, knowledgeId, t]);
  const screenRefresh = useScreenRefresh(load);

  useEffect(() => {
    void runInitialRequest(load);
  }, [load, runInitialRequest]);

  const index = useMemo(
    () => document?.chunks.findIndex((chunk) => chunk.id === blockId) ?? -1,
    [blockId, document],
  );
  const block = index >= 0 ? document?.chunks[index] : undefined;
  const previous = index > 0 ? document?.chunks[index - 1] : undefined;
  const next = index >= 0 ? document?.chunks[index + 1] : undefined;

  if (!document || !block) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <PageHeader
          onBack={onBack}
          onMore={() => showComingSoon(t('common.moreActions'))}
          title={t('blockDetail.title')}
        />
        <ScrollView
          alwaysBounceVertical
          contentContainerStyle={styles.emptyRefreshContent}
          refreshControl={<ScreenRefreshControl {...screenRefresh} />}
        >
          <EmptyState
            description={error || t('blockDetail.loadingDescription')}
            title={error ? t('common.loadFailed') : t('common.loading')}
          />
        </ScrollView>
      </SafeAreaView>
    );
  }

  const important = importantBlocks.has(block.id);
  return (
    <SafeAreaView style={styles.safeArea}>
      <PageHeader
        onBack={onBack}
        onMore={() => showComingSoon(t('common.moreActions'))}
        onSearch={() => showComingSoon(t('blockDetail.searchAction'))}
        searchLabel={t('blockDetail.search')}
        title={t('documentDetail.chunkTitle', {
          index: formatNumber(block.index),
          title: block.title || t('documentDetail.body'),
        })}
      />
      <ScrollView
        alwaysBounceVertical
        contentContainerStyle={styles.content}
        refreshControl={<ScreenRefreshControl {...screenRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.sectionTitle}>{t('blockDetail.details')}</Text>
        <View style={styles.metrics}>
          <Metric
            label={t('blockDetail.sequence')}
            value={`${formatNumber(block.index)}/${formatNumber(document.chunks.length)}`}
          />
          <Metric divider label="Vector ID" value={block.vectorId.slice(0, 8)} />
          <Metric
            divider
            label={t('documentDetail.characters')}
            value={formatNumber(block.charCount)}
          />
        </View>

        <Text style={styles.sectionTitle}>{t('blockDetail.content')}</Text>
        <ContentCard
          action={
            <Pressable
              accessibilityLabel={t('blockDetail.copyAccessibility')}
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => showComingSoon(t('blockDetail.copy'))}
            >
              <Ionicons color={colors.ink} name="copy-outline" size={typography.body.lineHeight} />
            </Pressable>
          }
          label={t('blockDetail.content')}
        >
          <Text selectable style={styles.body}>
            {block.content}
          </Text>
        </ContentCard>

        <View style={styles.sectionHeadingGroup}>
          <Text style={styles.sectionTitle}>{t('blockDetail.sourcePreview')}</Text>
          <Text style={styles.locator}>
            {t('blockDetail.sourceLocation', { location: locatorText(block, t) })}
          </Text>
        </View>
        <ContentCard
          action={
            <Pressable
              accessibilityLabel={t('blockDetail.fullscreenSource')}
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => onLocateOriginal(block.id)}
            >
              <Ionicons
                color={colors.ink}
                name="expand-outline"
                size={typography.body.lineHeight}
              />
            </Pressable>
          }
          label={t('blockDetail.original')}
        >
          <Text selectable style={styles.body}>
            {block.sourceExcerpt || block.content}
          </Text>
        </ContentCard>

        <View style={styles.sectionHeadingGroup}>
          <Text style={styles.sectionTitle}>{t('blockDetail.context')}</Text>
          <Text style={styles.locator}>
            {t('blockDetail.sourceLocation', { location: locatorText(block, t) })}
          </Text>
        </View>
        <View style={styles.contextList}>
          {previous ? (
            <ContextCard
              direction={t('blockDetail.previous')}
              onPress={() => onNavigateBlock(previous.id)}
              chunk={previous}
            />
          ) : null}
          {next ? (
            <ContextCard
              direction={t('blockDetail.next')}
              onPress={() => onNavigateBlock(next.id)}
              chunk={next}
            />
          ) : null}
          {!previous && !next ? (
            <Text style={styles.emptyText}>{t('blockDetail.noOther')}</Text>
          ) : null}
        </View>
      </ScrollView>

      <View style={styles.fixedFooter} testID="block-fixed-footer">
        <View style={styles.actionRow}>
          <FooterAction
            icon="copy-outline"
            label={t('blockDetail.copy')}
            onPress={() => showComingSoon(t('blockDetail.copy'))}
          />
          <FooterAction
            icon="location-outline"
            label={t('blockDetail.locate')}
            onPress={() => onLocateOriginal(block.id)}
          />
          <FooterAction
            icon={important ? 'star' : 'star-outline'}
            label={important ? t('blockDetail.unmark') : t('blockDetail.mark')}
            onPress={() => toggleImportantBlock(block.id)}
            selected={important}
          />
        </View>
        <View style={styles.pagination}>
          <PaginationButton
            direction="previous"
            disabled={!previous}
            label={t('blockDetail.previous')}
            onPress={() => previous && onNavigateBlock(previous.id)}
          />
          <Text style={styles.pageCount}>
            {block.index} / {document.chunks.length}
          </Text>
          <PaginationButton
            direction="next"
            disabled={!next}
            label={t('blockDetail.next')}
            onPress={() => next && onNavigateBlock(next.id)}
          />
        </View>
      </View>
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

function ContentCard({
  action,
  children,
  label,
}: {
  action?: React.ReactNode;
  children: React.ReactNode;
  label: string;
}) {
  return (
    <View style={styles.contentCard}>
      <View style={styles.cardHeader}>
        <View>
          <Text style={styles.cardLabel}>{label}</Text>
          <View style={styles.cardLabelLine} />
        </View>
        {action}
      </View>
      <View style={styles.cardContent}>{children}</View>
    </View>
  );
}

function ContextCard({
  chunk,
  direction,
  onPress,
}: {
  chunk: DocumentChunk;
  direction: string;
  onPress: () => void;
}) {
  const { formatNumber, t } = useAppLanguage();
  return (
    <Pressable
      accessibilityLabel={t('blockDetail.contextAccessibility', {
        direction,
        title: chunk.title,
      })}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.contextCard, pressed && styles.pressed]}
    >
      <Text style={styles.contextTitle}>
        {t('blockDetail.contextTitle', {
          direction,
          index: formatNumber(chunk.index),
          title: chunk.title || t('documentDetail.body'),
        })}
      </Text>
      <View style={styles.contextBodyRow}>
        <Text numberOfLines={2} style={styles.contextBody}>
          {chunk.content}
        </Text>
        <Ionicons
          color={colors.muted}
          name="chevron-forward"
          size={typography.heading1.lineHeight}
        />
      </View>
      <View style={styles.contextMetaRow}>
        <Text style={styles.meta}>
          {t('documentDetail.vectorId', { id: chunk.vectorId.slice(0, 8) })}
        </Text>
        <Text style={styles.meta}>
          {t('documentDetail.characterCount', { count: formatNumber(chunk.charCount) })}
        </Text>
      </View>
    </Pressable>
  );
}

function FooterAction({
  icon,
  label,
  onPress,
  selected = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  selected?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.footerAction,
        selected && styles.selectedAction,
        pressed && styles.pressed,
      ]}
    >
      <Ionicons color={colors.ink} name={icon} size={typography.body.lineHeight} />
      <Text numberOfLines={1} style={styles.footerActionText}>
        {label}
      </Text>
    </Pressable>
  );
}

function PaginationButton({
  direction,
  disabled,
  label,
  onPress,
}: {
  direction: 'next' | 'previous';
  disabled: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.paginationButton,
        disabled && styles.disabledButton,
        pressed && !disabled && styles.pressed,
      ]}
    >
      {direction === 'previous' ? (
        <Ionicons
          color={disabled ? colors.muted : colors.ink}
          name="chevron-back"
          size={typography.heading5.lineHeight}
        />
      ) : null}
      <Text style={[styles.paginationButtonText, disabled && styles.disabledText]}>{label}</Text>
      {direction === 'next' ? (
        <Ionicons
          color={disabled ? colors.muted : colors.ink}
          name="chevron-forward"
          size={typography.heading5.lineHeight}
        />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.card, flex: 1 },
  emptyRefreshContent: { flexGrow: 1 },
  content: { gap: spacing.lg, padding: spacing.md, paddingBottom: spacing.xl },
  sectionTitle: {
    ...typography.heading1,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  sectionHeadingGroup: { gap: spacing.sm },
  metrics: { flexDirection: 'row', paddingVertical: spacing.md },
  metric: { alignItems: 'center', flex: 1, gap: spacing.sm, minWidth: 0 },
  metricDivider: { borderLeftColor: colors.divider, borderLeftWidth: StyleSheet.hairlineWidth },
  metricValue: {
    ...typography.heading2,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  meta: { ...typography.description, color: textColors.secondary, fontFamily: fontFamilies.sans },
  locator: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  contentCard: {
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    overflow: 'hidden',
  },
  cardHeader: {
    alignItems: 'center',
    borderBottomColor: colors.divider,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  cardLabel: {
    ...typography.heading3,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
    paddingBottom: spacing.xs,
  },
  cardLabelLine: { backgroundColor: colors.ink, height: 2 },
  cardContent: { padding: spacing.md },
  body: { ...typography.body, color: textColors.primary, fontFamily: fontFamilies.sans },
  contextList: { gap: spacing.sm },
  contextCard: {
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  contextTitle: {
    ...typography.heading3,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  contextBodyRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  contextBody: {
    ...typography.description,
    color: textColors.secondary,
    flex: 1,
    fontFamily: fontFamilies.sans,
  },
  contextMetaRow: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'space-between' },
  emptyText: {
    ...typography.body,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    textAlign: 'center',
  },
  fixedFooter: {
    backgroundColor: colors.card,
    borderTopColor: colors.divider,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.md,
    padding: spacing.md,
  },
  actionRow: { flexDirection: 'row', gap: spacing.sm },
  footerAction: {
    alignItems: 'center',
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.xs,
  },
  selectedAction: { backgroundColor: colors.successSurface, borderColor: colors.ink },
  footerActionText: {
    ...typography.description,
    color: textColors.primary,
    fontFamily: fontFamilies.sans,
  },
  pagination: {
    alignItems: 'center',
    borderTopColor: colors.divider,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: spacing.md,
  },
  paginationButton: {
    alignItems: 'center',
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 40,
    paddingHorizontal: spacing.sm,
  },
  paginationButtonText: {
    ...typography.description,
    color: textColors.primary,
    fontFamily: fontFamilies.sans,
  },
  disabledButton: { backgroundColor: colors.background },
  disabledText: { color: textColors.tertiary },
  pageCount: { ...typography.body, color: textColors.primary, fontFamily: fontFamilies.sans },
  pressed: { backgroundColor: colors.background },
});
