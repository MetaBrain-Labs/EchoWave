/** Shows one parsed block, its source, neighboring context, and session emphasis state. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '../../theme/tokens';
import { EmptyState, PageHeader, showComingSoon } from './KnowledgeShared';
import { getKnowledgeDocument, getParsedBlock, type ParsedBlock } from './mockData';
import { getImportantBlockIds, setBlockImportant } from './preferences';

function DetailMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function ContentCard({
  action,
  actionLabel,
  children,
  title,
}: {
  action?: () => void;
  actionLabel?: string;
  children: React.ReactNode;
  title: string;
}) {
  return (
    <View style={styles.contentCard}>
      <View style={styles.contentCardHeader}>
        <Text style={styles.contentCardTitle}>{title}</Text>
        {action && actionLabel ? (
          <Pressable
            accessibilityLabel={actionLabel}
            accessibilityRole="button"
            onPress={action}
            style={({ pressed }) => [styles.cardAction, pressed && styles.pressed]}
          >
            <Ionicons
              color={colors.ink}
              name={actionLabel.includes('全屏') ? 'expand-outline' : 'copy-outline'}
              size={20}
            />
          </Pressable>
        ) : null}
      </View>
      <View style={styles.contentCardBody}>{children}</View>
    </View>
  );
}

function ContextCard({
  block,
  label,
  onPress,
}: {
  block: ParsedBlock;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={`打开${label}：${block.title}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.contextCard, pressed && styles.pressed]}
    >
      <Text style={styles.contextTitle}>{label}：块 {block.index} · {block.title}</Text>
      <Text numberOfLines={2} style={styles.contextExcerpt}>{block.content}</Text>
      <View style={styles.contextMetaRow}>
        <Text style={styles.contextMeta}>向量 ID：{block.vectorId}</Text>
        <Text style={styles.contextMeta}>字符数：{block.charCount}</Text>
      </View>
      <Ionicons color={colors.muted} name="chevron-forward" size={24} style={styles.contextChevron} />
    </Pressable>
  );
}

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
  const document = getKnowledgeDocument(knowledgeId, documentId);
  const block = getParsedBlock(knowledgeId, documentId, blockId);
  const [important, setImportant] = useState(() => getImportantBlockIds().has(blockId));

  if (!document || !block) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <PageHeader onBack={onBack} title="文本块详情" />
        <EmptyState
          description="该文本块可能已被移除，请返回文件详情。"
          title="未找到文本块"
        />
      </SafeAreaView>
    );
  }

  const index = document.blocks.findIndex((item) => item.id === block.id);
  const previous = document.blocks[index - 1];
  const next = document.blocks[index + 1];
  const setImportantState = () => {
    const nextImportant = !important;
    setBlockImportant(block.id, nextImportant);
    setImportant(nextImportant);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <PageHeader onBack={onBack} title={`块 ${block.index} · ${block.title}`} />
      <ScrollView contentContainerStyle={styles.pageContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionTitle}>块详情</Text>
        <View style={styles.metricsRow}>
          <DetailMetric label="块序号" value={`${block.index}/${document.blocks.length}`} />
          <DetailMetric label="向量 ID" value={block.vectorId} />
          <DetailMetric label="字符数" value={block.charCount} />
        </View>

        <Text style={styles.sectionTitle}>块内容</Text>
        <ContentCard
          action={() => showComingSoon('复制内容')}
          actionLabel="复制块内容"
          title="块内容"
        >
          <Text selectable style={styles.bodyText}>{block.content}</Text>
        </ContentCard>

        <Text style={styles.sectionTitle}>来源预览</Text>
        <Text style={styles.locationText}>来源位置：第 {block.page} 页 第 {block.line} 行</Text>
        <ContentCard
          action={() => onLocateOriginal(block.id)}
          actionLabel="全屏定位原文"
          title="原文"
        >
          <Text selectable style={styles.bodyText}>{block.sourceExcerpt}</Text>
        </ContentCard>

        {(previous || next) ? (
          <>
            <Text style={styles.sectionTitle}>关联上下文</Text>
            <Text style={styles.locationText}>来源位置：第 {block.page} 页 第 {block.line} 行</Text>
            <View style={styles.contextList}>
              {previous ? (
                <ContextCard block={previous} label="上一块" onPress={() => onNavigateBlock(previous.id)} />
              ) : null}
              {next ? (
                <ContextCard block={next} label="下一块" onPress={() => onNavigateBlock(next.id)} />
              ) : null}
            </View>
          </>
        ) : null}

        <View style={styles.actionRow}>
          <Pressable
            accessibilityRole="button"
            onPress={() => showComingSoon('复制内容')}
            style={({ pressed }) => [styles.secondaryAction, pressed && styles.pressed]}
          >
            <Ionicons color={colors.ink} name="copy-outline" size={20} />
            <Text style={styles.actionText}>复制内容</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => onLocateOriginal(block.id)}
            style={({ pressed }) => [styles.secondaryAction, pressed && styles.pressed]}
          >
            <Ionicons color={colors.ink} name="location-outline" size={20} />
            <Text style={styles.actionText}>定位原文</Text>
          </Pressable>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: important }}
            onPress={setImportantState}
            style={({ pressed }) => [styles.secondaryAction, styles.importantAction, pressed && styles.pressed]}
          >
            <Ionicons color={colors.ink} name={important ? 'star' : 'star-outline'} size={20} />
            <Text style={styles.actionText}>{important ? '取消重点' : '设为重点'}</Text>
          </Pressable>
        </View>

        <View style={styles.pagination}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !previous }}
            disabled={!previous}
            onPress={() => previous && onNavigateBlock(previous.id)}
            style={({ pressed }) => [
              styles.pageButton,
              !previous && styles.disabledButton,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons color={previous ? colors.ink : colors.muted} name="chevron-back" size={18} />
            <Text style={[styles.pageButtonText, !previous && styles.disabledText]}>上一块</Text>
          </Pressable>
          <Text style={styles.pageCount}>{block.index} / {document.blocks.length}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !next }}
            disabled={!next}
            onPress={() => next && onNavigateBlock(next.id)}
            style={({ pressed }) => [
              styles.pageButton,
              !next && styles.disabledButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.pageButtonText, !next && styles.disabledText]}>下一块</Text>
            <Ionicons color={next ? colors.ink : colors.muted} name="chevron-forward" size={18} />
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.card, flex: 1 },
  pageContent: { gap: spacing.md, padding: spacing.md, paddingBottom: spacing.xl },
  sectionTitle: { ...typography.heading1, color: textColors.primary, fontFamily: fontFamilies.sansBold, fontWeight: 'bold' },
  metricsRow: { flexDirection: 'row', paddingVertical: spacing.md },
  metric: { alignItems: 'center', borderLeftColor: colors.divider, borderLeftWidth: StyleSheet.hairlineWidth, flex: 1, gap: spacing.sm, paddingHorizontal: spacing.xs },
  metricValue: { ...typography.heading2, color: textColors.primary, fontFamily: fontFamilies.sansBold, fontWeight: 'bold', textAlign: 'center' },
  metricLabel: { ...typography.description, color: textColors.secondary, fontFamily: fontFamilies.sans, textAlign: 'center' },
  contentCard: { borderColor: colors.divider, borderRadius: radii.default, borderWidth: 1, overflow: 'hidden' },
  contentCardHeader: { alignItems: 'center', borderBottomColor: colors.divider, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', minHeight: 48, paddingHorizontal: spacing.md },
  contentCardTitle: { ...typography.heading2, color: textColors.primary, flex: 1, fontFamily: fontFamilies.sansBold, fontWeight: 'bold' },
  cardAction: { alignItems: 'center', height: 40, justifyContent: 'center', width: 40 },
  contentCardBody: { padding: spacing.md },
  bodyText: { ...typography.body, color: textColors.primary, fontFamily: fontFamilies.sans },
  locationText: { ...typography.body, color: textColors.secondary, fontFamily: fontFamilies.sans },
  contextList: { gap: spacing.sm },
  contextCard: { borderColor: colors.divider, borderRadius: radii.default, borderWidth: 1, gap: spacing.sm, padding: spacing.md, paddingRight: spacing.xl, position: 'relative' },
  contextTitle: { ...typography.heading2, color: textColors.primary, fontFamily: fontFamilies.sansBold, fontWeight: 'bold' },
  contextExcerpt: { ...typography.body, color: textColors.secondary, fontFamily: fontFamilies.sans },
  contextMetaRow: { flexDirection: 'row', justifyContent: 'space-between' },
  contextMeta: { ...typography.description, color: textColors.secondary, fontFamily: fontFamilies.sans },
  contextChevron: { position: 'absolute', right: spacing.xs, top: 52 },
  actionRow: { flexDirection: 'row', gap: spacing.sm, paddingTop: spacing.md },
  secondaryAction: { alignItems: 'center', backgroundColor: colors.background, borderColor: colors.divider, borderRadius: radii.default, borderWidth: 1, flex: 1, gap: spacing.xs, justifyContent: 'center', minHeight: 56, paddingHorizontal: spacing.xs },
  importantAction: { borderColor: colors.ink },
  actionText: { ...typography.description, color: textColors.primary, fontFamily: fontFamilies.sansBold, fontWeight: 'bold', textAlign: 'center' },
  pagination: { alignItems: 'center', borderTopColor: colors.divider, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', paddingTop: spacing.md },
  pageButton: { alignItems: 'center', backgroundColor: colors.background, borderColor: colors.divider, borderRadius: radii.default, borderWidth: 1, flexDirection: 'row', minHeight: 44, paddingHorizontal: spacing.sm },
  disabledButton: { borderColor: colors.divider },
  pageButtonText: { ...typography.body, color: textColors.primary, fontFamily: fontFamilies.sans },
  disabledText: { color: textColors.tertiary },
  pageCount: { ...typography.body, color: textColors.primary, fontFamily: fontFamilies.sans },
  pressed: { backgroundColor: colors.canvas },
});
