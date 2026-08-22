/**
 * 可信回答引用列表。
 *
 * 默认展示前四条已验证引用，并允许用户按需展开或收起其余来源，避免长引用列表淹没聊天内容。
 *
 * Responsibilities:
 * - 渲染引用定位、摘要与原文跳转入口。
 * - 管理单条回答内部的引用展开状态。
 *
 * Notes:
 * - 折叠仅影响展示，服务端返回的完整引用集合始终保留。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type { RagQueryResponse } from '@echowave/contracts';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';

const COLLAPSED_CITATION_COUNT = 4;

type Citation = RagQueryResponse['citations'][number];

function locatorLabel(locator: Citation['locator']) {
  if (locator.kind === 'spreadsheet')
    return `${locator.sheet} · 第 ${locator.rowStart}-${locator.rowEnd} 行`;
  if (locator.kind === 'word')
    return `${locator.headingPath.join(' / ') || '正文'} · 第 ${locator.paragraphStart}-${locator.paragraphEnd} 段`;
  return `${locator.headingPath.join(' / ') || '正文'} · 第 ${locator.lineStart}-${locator.lineEnd} 行`;
}

/** 渲染默认折叠、可访问且可跳转原文的完整引用集合。 */
export function CitationList({
  citations,
  onOpenCitation,
}: {
  citations: RagQueryResponse['citations'];
  onOpenCitation: (documentId: string, chunkId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hiddenCount = Math.max(0, citations.length - COLLAPSED_CITATION_COUNT);
  const visibleCitations = expanded ? citations : citations.slice(0, COLLAPSED_CITATION_COUNT);

  return (
    <View style={styles.list}>
      {visibleCitations.map((citation) => (
        <Pressable
          key={citation.chunkId}
          accessibilityRole="link"
          onPress={() => onOpenCitation(citation.documentId, citation.chunkId)}
          style={({ pressed }) => [styles.citation, pressed && styles.pressed]}
        >
          <Text style={styles.citationTitle}>
            [{citation.number}] {citation.documentTitle}
          </Text>
          <Text style={styles.citationMeta}>{locatorLabel(citation.locator)}</Text>
          <Text numberOfLines={3} style={styles.citationExcerpt}>
            {citation.excerpt}
          </Text>
        </Pressable>
      ))}
      {hiddenCount > 0 ? (
        <Pressable
          accessibilityLabel={expanded ? '收起引用来源' : `展开其余 ${hiddenCount} 条引用来源`}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={() => setExpanded((value) => !value)}
          style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}
        >
          <Text style={styles.toggleText}>
            {expanded ? '收起引用' : `展开其余 ${hiddenCount} 条引用`}
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
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  citation: {
    backgroundColor: colors.background,
    borderRadius: radii.default,
    gap: spacing.xs,
    padding: spacing.sm,
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
