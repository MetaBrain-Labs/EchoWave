/**
 * 文档块详情页面。
 *
 * 展示服务器权威的文档块正文、原文定位和相邻块导航，并为加载失败提供可理解状态。
 *
 * Responsibilities:
 * - 加载并渲染指定文档块。
 * - 提供上一块、下一块与来源定位操作。
 *
 * Notes:
 * - 不在客户端复制或修改正文事实。
 */
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { DocumentChunk, KnowledgeDocumentDetail } from '@echowave/contracts';

import { colors, fontFamilies, radii, spacing, textColors, typography } from '@/shared/theme/tokens';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { getDocument } from '../apiClient';

function locatorText(chunk: DocumentChunk) {
  const locator = chunk.locator;
  if (locator.kind === 'spreadsheet') return `${locator.sheet}，第 ${locator.rowStart}-${locator.rowEnd} 行`;
  if (locator.kind === 'word') return `${locator.headingPath.join(' / ') || '正文'}，第 ${locator.paragraphStart}-${locator.paragraphEnd} 段`;
  return `${locator.headingPath.join(' / ') || '正文'}，第 ${locator.lineStart}-${locator.lineEnd} 行`;
}

/** 加载并展示指定文档块及其相邻块导航。 */
export function BlockDetailScreen({ blockId, documentId, knowledgeId, onBack, onLocateOriginal, onNavigateBlock }: {
  blockId: string;
  documentId: string;
  knowledgeId: string;
  onBack: () => void;
  onLocateOriginal: (blockId: string) => void;
  onNavigateBlock: (blockId: string) => void;
}) {
  const [document, setDocument] = useState<KnowledgeDocumentDetail>();
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void getDocument(knowledgeId, documentId)
      .then((value) => { if (active) setDocument(value); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : '文本块加载失败。'); });
    return () => { active = false; };
  }, [documentId, knowledgeId]);
  const index = useMemo(() => document?.chunks.findIndex((chunk) => chunk.id === blockId) ?? -1, [blockId, document]);
  const block = index >= 0 ? document?.chunks[index] : undefined;
  const previous = index > 0 ? document?.chunks[index - 1] : undefined;
  const next = index >= 0 ? document?.chunks[index + 1] : undefined;

  if (!document || !block) {
    return <SafeAreaView style={styles.safeArea}><PageHeader onBack={onBack} title="文本块详情" /><EmptyState description={error || '正在从服务器读取文本块。'} title={error ? '加载失败' : '正在加载'} /></SafeAreaView>;
  }
  return (
    <SafeAreaView style={styles.safeArea}>
      <PageHeader onBack={onBack} title={`块 ${block.index} · ${block.title || '正文'}`} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.metrics}><Metric label="块序号" value={`${block.index}/${document.chunks.length}`} /><Metric label="字符数" value={block.charCount} /><Metric label="向量 ID" value={block.vectorId.slice(0, 8)} /></View>
        <Text style={styles.sectionTitle}>来源定位</Text>
        <View style={styles.locatorRow}>
          <Text style={styles.locator}>{locatorText(block)}</Text>
          <Pressable
            accessibilityLabel="在文档原文中定位"
            accessibilityRole="button"
            onPress={() => onLocateOriginal(block.id)}
            style={({ pressed }) => [styles.locateButton, pressed && styles.pressed]}
          >
            <Text style={styles.locateButtonText}>查看原文</Text>
          </Pressable>
        </View>
        <View style={styles.highlight}><Text selectable style={styles.body}>{block.content}</Text></View>
        <View style={styles.pagination}>
          <Pressable disabled={!previous} onPress={() => previous && onNavigateBlock(previous.id)} style={styles.button}><Text style={styles.buttonText}>上一块</Text></Pressable>
          <Pressable disabled={!next} onPress={() => next && onNavigateBlock(next.id)} style={styles.button}><Text style={styles.buttonText}>下一块</Text></Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) { return <View style={styles.metric}><Text style={styles.metricValue}>{value}</Text><Text style={styles.meta}>{label}</Text></View>; }
const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.card, flex: 1 }, content: { gap: spacing.md, padding: spacing.md },
  metrics: { flexDirection: 'row' }, metric: { alignItems: 'center', flex: 1, gap: spacing.xs },
  metricValue: { ...typography.heading2, color: textColors.primary, fontFamily: fontFamilies.sansBold, fontWeight: 'bold' },
  meta: { ...typography.description, color: textColors.secondary, fontFamily: fontFamilies.sans },
  sectionTitle: { ...typography.heading1, color: textColors.primary, fontFamily: fontFamilies.sansBold, fontWeight: 'bold' },
  locator: { ...typography.body, color: textColors.secondary, fontFamily: fontFamilies.sans },
  locatorRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, justifyContent: 'space-between' },
  locateButton: { borderColor: colors.divider, borderRadius: radii.default, borderWidth: 1, minHeight: 40, paddingHorizontal: spacing.sm, justifyContent: 'center' },
  locateButtonText: { ...typography.description, color: textColors.primary, fontFamily: fontFamilies.sansBold, fontWeight: 'bold' },
  highlight: { backgroundColor: '#fff9d9', borderColor: colors.ink, borderRadius: radii.default, borderWidth: 1, padding: spacing.md },
  body: { ...typography.body, color: textColors.primary, fontFamily: fontFamilies.sans },
  pagination: { flexDirection: 'row', justifyContent: 'space-between' },
  button: { borderColor: colors.divider, borderRadius: radii.default, borderWidth: 1, minHeight: 44, paddingHorizontal: spacing.md, justifyContent: 'center' },
  buttonText: { ...typography.body, color: textColors.primary, fontFamily: fontFamilies.sans },
  pressed: { opacity: 0.72 },
});
