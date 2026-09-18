/**
 * 可信回答引用列表。
 *
 * 默认展示前四条已验证引用，并允许用户按需展开或收起其余来源，避免长引用列表淹没聊天内容；
 * 同时支持从答案正文的标记跳转到对应卡片并临时高亮。
 *
 * Responsibilities:
 * - 渲染引用定位、摘要与原文跳转入口。
 * - 管理单条回答内部的引用展开状态。
 * - 按引用编号计算卡片在列表内的偏移并上报给上层滚动。
 *
 * Notes:
 * - 折叠仅影响展示，服务端返回的完整引用集合始终保留。
 * - 卡片点击仍只打开引用快照弹层，不触发原文跳转。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type { RagQueryResponse } from '@echowave/contracts';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CitationSnapshotModal } from '@/shared/ui/CitationSnapshotModal';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';

import { alignCitationNumbers } from './citationDisplay';

const COLLAPSED_CITATION_COUNT = 4;

type Citation = RagQueryResponse['citations'][number];

/** 引用卡片在列表内的布局，供正文标记计算目标滚动位置。 */
type CardLayout = { height: number; y: number };

/** 引用列表对外的命令式入口，用于从答案正文跳转到指定编号。 */
export type CitationListHandle = {
  scrollToCitation: (number: number) => void;
};

function locatorLabel(
  locator: Citation['locator'],
  t: ReturnType<typeof useAppLanguage>['t'],
  formatNumber: ReturnType<typeof useAppLanguage>['formatNumber'],
) {
  if (locator.kind === 'spreadsheet')
    return t('blockDetail.sheetLocation', {
      sheet: locator.sheet,
      start: formatNumber(locator.rowStart),
      end: formatNumber(locator.rowEnd),
    });
  if (locator.kind === 'word')
    return t('blockDetail.paragraphLocation', {
      heading: locator.headingPath.join(' / ') || t('documentDetail.body'),
      start: formatNumber(locator.paragraphStart),
      end: formatNumber(locator.paragraphEnd),
    });
  return t('blockDetail.lineLocation', {
    heading: locator.headingPath.join(' / ') || t('documentDetail.body'),
    start: formatNumber(locator.lineStart),
    end: formatNumber(locator.lineEnd),
  });
}

/** 渲染默认折叠、可访问且可跳转原文的完整引用集合。 */
export const CitationList = forwardRef<
  CitationListHandle,
  {
    citations: RagQueryResponse['citations'];
    knowledgeId?: string;
    /** 由正文标记触发的目标编号；父层据此高亮对应卡片。 */
    highlightedNumber?: number;
    onOpenCitation: (documentId: string, chunkId: string) => void;
    /** 目标卡片在列表内的偏移与高度，由父层换算成页面滚动位置。 */
    onScrollToOffset?: (offset: number, height: number) => void;
    /** 跳转完成回调，父层据此清除高亮。 */
    onScrolled?: () => void;
  }
>(function CitationList(
  { citations, knowledgeId, highlightedNumber, onOpenCitation, onScrollToOffset, onScrolled },
  ref,
) {
  const { formatNumber, t } = useAppLanguage();
  const [selected, setSelected] = useState<Citation>();
  const [expanded, setExpanded] = useState(false);
  const [layoutTick, setLayoutTick] = useState(0);
  const layouts = useRef(new Map<number, CardLayout>());
  const pendingRef = useRef<number | undefined>(undefined);
  // 展示编号统一收敛为 1..N，避免历史回答出现指向清单之外的 [n]。
  const displayCitations = alignCitationNumbers(citations);
  const hiddenCount = Math.max(0, displayCitations.length - COLLAPSED_CITATION_COUNT);
  const visibleCitations = expanded
    ? displayCitations
    : displayCitations.slice(0, COLLAPSED_CITATION_COUNT);

  // 卡片高度是唯一的跨端可信度量；列表内偏移由已布局卡片累加得出。
  const cardOffset = useCallback((number: number): CardLayout | undefined => {
    let offset = 0;
    for (const [cardNumber, layout] of [...layouts.current.entries()].sort(
      (left, right) => left[0] - right[0],
    )) {
      if (cardNumber === number) return { height: layout.height, y: offset };
      offset += layout.height + spacing.sm;
    }
    return undefined;
  }, []);

  const scrollToCitation = useCallback((number: number) => {
    // 目标卡片可能仍在折叠区，需要先展开再等待布局上报。
    if (number > COLLAPSED_CITATION_COUNT) setExpanded(true);
    layouts.current.delete(number);
    pendingRef.current = number;
    setLayoutTick((value) => value + 1);
  }, []);

  useImperativeHandle(ref, () => ({ scrollToCitation }), [scrollToCitation]);

  useEffect(() => {
    const number = pendingRef.current;
    if (number === undefined || !onScrollToOffset) return;
    const layout = cardOffset(number);
    if (!layout) return;
    pendingRef.current = undefined;
    onScrollToOffset(layout.y, layout.height);
    onScrolled?.();
  }, [onScrolled, onScrollToOffset, cardOffset, layoutTick]);

  return (
    <View style={styles.list}>
      <CitationSnapshotModal
        citation={
          selected
            ? { ...selected, knowledgeBaseId: selected.knowledgeBaseId ?? knowledgeId }
            : undefined
        }
        onClose={() => setSelected(undefined)}
        onOpenCurrent={() => {
          if (selected) onOpenCitation(selected.documentId, selected.chunkId);
        }}
      />
      {visibleCitations.map((citation) => (
        <Pressable
          key={citation.chunkId}
          accessibilityRole="link"
          onLayout={(event) => {
            const { height, y } = event.nativeEvent.layout;
            const previous = layouts.current.get(citation.number);
            layouts.current.set(citation.number, { height, y });
            // 目标卡片刚完成布局时再上报一次，避免跳转落在展开前的位置上。
            if (pendingRef.current === citation.number && previous?.y !== y) {
              setLayoutTick((value) => value + 1);
            }
          }}
          onPress={() => setSelected(citation)}
          style={[
            styles.citation,
            citation.number === highlightedNumber && styles.citationHighlighted,
          ]}
        >
          <Text style={styles.citationTitle}>
            [{citation.number}] {citation.documentTitle}
          </Text>
          <Text style={styles.citationMeta}>{locatorLabel(citation.locator, t, formatNumber)}</Text>
          <Text numberOfLines={3} style={styles.citationExcerpt}>
            {citation.excerpt}
          </Text>
        </Pressable>
      ))}
      {hiddenCount > 0 ? (
        <Pressable
          accessibilityLabel={
            expanded
              ? t('citation.collapse')
              : t('citation.expand', { count: formatNumber(hiddenCount) })
          }
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={() => setExpanded((value) => !value)}
          style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}
        >
          <Text style={styles.toggleText}>
            {expanded
              ? t('citation.collapseShort')
              : t('citation.expandShort', { count: formatNumber(hiddenCount) })}
          </Text>
          <Ionicons
            color={textColors.secondary}
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={16}
          />
        </Pressable>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  citation: {
    backgroundColor: colors.background,
    borderColor: 'transparent',
    borderRadius: radii.default,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.sm,
  },
  citationHighlighted: {
    backgroundColor: colors.primarySurface,
    borderColor: colors.primaryBorder,
  },
  citationTitle: {
    ...typography.description,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  citationMeta: { ...typography.label, color: textColors.secondary, fontFamily: fontFamilies.sans },
  citationExcerpt: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
  },
  toggle: {
    alignItems: 'center',
    alignSelf: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  toggleText: {
    ...typography.description,
    color: textColors.secondary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  pressed: { opacity: 0.72 },
});
