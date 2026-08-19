/** Renders server-authoritative parsed chunks and normalized source preview for one document. */
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { KnowledgeDocumentDetail } from '@echowave/contracts';

import { colors, fontFamilies, radii, spacing, textColors, typography } from '../../theme/tokens';
import { DocumentFormatIcon, EmptyState, PageHeader, PageTabs, SearchAndFilter } from './KnowledgeShared';
import { getDocument } from './apiClient';

const tabs = [{ key: 'parsed', label: '文档解析' }, { key: 'original', label: '文档原文' }] as const;
type Tab = (typeof tabs)[number]['key'];

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
  const [document, setDocument] = useState<KnowledgeDocumentDetail>();
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void getDocument(knowledgeId, documentId)
      .then((value) => { if (active) setDocument(value); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : '文档加载失败。'); });
    return () => { active = false; };
  }, [documentId, knowledgeId]);

  const chunks = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return document?.chunks ?? [];
    return (document?.chunks ?? []).filter((chunk) => `${chunk.title}\n${chunk.content}`.toLocaleLowerCase().includes(normalized));
  }, [document, query]);

  if (!document) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <PageHeader onBack={onBack} title="文件详情" />
        <EmptyState description={error || '正在从服务器读取解析结果。'} title={error ? '加载失败' : '正在加载'} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <PageHeader icon={document.format} onBack={onBack} title={document.title} />
      <PageTabs activeTab={activeTab} onChange={setActiveTab} tabs={tabs} />
      {activeTab === 'parsed' ? (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.metrics}>
            <Metric label="文本块" value={document.vectorCount} />
            <Metric label="文件大小" value={`${(document.sizeBytes / 1024).toFixed(1)} KB`} />
            <Metric label="格式" value={document.format.toUpperCase()} />
          </View>
          <SearchAndFilter onChangeText={setQuery} placeholder="搜索文本块..." value={query} />
          {chunks.map((chunk) => (
            <Pressable
              key={chunk.id}
              accessibilityLabel={`打开文本块：${chunk.title}`}
              accessibilityRole="button"
              onPress={() => onOpenBlock(chunk.id)}
              style={({ pressed }) => [styles.chunk, chunk.id === initialBlockId && styles.highlight, pressed && styles.pressed]}
            >
              <View style={styles.chunkHeader}>
                <Text style={styles.chunkTitle}>块 {chunk.index} · {chunk.title || '正文'}</Text>
                <DocumentFormatIcon format={document.format} size={20} />
              </View>
              <Text numberOfLines={4} style={styles.body}>{chunk.content}</Text>
              <Text style={styles.meta}>{chunk.charCount} 字符 · {chunk.vectorId.slice(0, 8)}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Text selectable style={[styles.body, styles.source]}>{document.previewText || '原文件已在解析后删除，当前没有规范化文本预览。'}</Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <View style={styles.metric}><Text style={styles.metricValue}>{value}</Text><Text style={styles.meta}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.card, flex: 1 },
  content: { gap: spacing.md, padding: spacing.md, paddingBottom: spacing.xl },
  metrics: { flexDirection: 'row' },
  metric: { alignItems: 'center', flex: 1, gap: spacing.xs },
  metricValue: { ...typography.heading2, color: textColors.primary, fontFamily: fontFamilies.sansBold, fontWeight: 'bold' },
  chunk: { borderColor: colors.divider, borderRadius: radii.default, borderWidth: 1, gap: spacing.sm, padding: spacing.md },
  highlight: { backgroundColor: '#fff9d9', borderColor: colors.ink },
  chunkHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  chunkTitle: { ...typography.heading2, color: textColors.primary, flex: 1, fontFamily: fontFamilies.sansBold, fontWeight: 'bold' },
  body: { ...typography.body, color: textColors.primary, fontFamily: fontFamilies.sans },
  source: { borderColor: colors.divider, borderRadius: radii.default, borderWidth: 1, padding: spacing.md },
  meta: { ...typography.description, color: textColors.secondary, fontFamily: fontFamilies.sans },
  pressed: { opacity: 0.72 },
});
