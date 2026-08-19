/** Provides ephemeral grounded knowledge-base chat with traceable citation navigation. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { RagQueryResponse } from '@echowave/contracts';

import { colors, fontFamilies, radii, spacing, textColors, typography } from '../../theme/tokens';
import { PageHeader } from './KnowledgeShared';
import { queryKnowledge } from './apiClient';

type Turn = { question: string; response: RagQueryResponse };

function locatorLabel(locator: RagQueryResponse['citations'][number]['locator']) {
  if (locator.kind === 'spreadsheet') return `${locator.sheet} · 第 ${locator.rowStart}-${locator.rowEnd} 行`;
  if (locator.kind === 'word') return `${locator.headingPath.join(' / ') || '正文'} · 第 ${locator.paragraphStart}-${locator.paragraphEnd} 段`;
  return `${locator.headingPath.join(' / ') || '正文'} · 第 ${locator.lineStart}-${locator.lineEnd} 行`;
}

export function KnowledgeQueryScreen({
  knowledgeId,
  onBack,
  onOpenCitation,
}: {
  knowledgeId: string;
  onBack: () => void;
  onOpenCitation: (documentId: string, chunkId: string) => void;
}) {
  const [question, setQuestion] = useState('');
  const [conversationId, setConversationId] = useState<string>();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    const value = question.trim();
    if (!value || loading) return;
    setLoading(true);
    setError('');
    try {
      const response = await queryKnowledge(knowledgeId, value, conversationId);
      setConversationId(response.conversationId);
      setTurns((items) => [...items, { question: value, response }]);
      setQuestion('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '问答请求失败。');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <PageHeader onBack={onBack} title="问知识库" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {turns.length === 0 ? (
          <Text style={styles.hint}>回答只基于已完成解析的知识库文档；依据不足时会明确拒答。</Text>
        ) : null}
        {turns.map((turn, turnIndex) => (
          <View key={`${turn.response.conversationId}-${turnIndex}`} style={styles.turn}>
            <View style={styles.questionBubble}><Text style={styles.questionText}>{turn.question}</Text></View>
            <View style={styles.answerCard}>
              <Text selectable style={styles.answerText}>{turn.response.answer}</Text>
              {turn.response.citations.map((citation) => (
                <Pressable
                  key={citation.chunkId}
                  accessibilityRole="link"
                  onPress={() => onOpenCitation(citation.documentId, citation.chunkId)}
                  style={({ pressed }) => [styles.citation, pressed && styles.pressed]}
                >
                  <Text style={styles.citationTitle}>[{citation.number}] {citation.documentTitle}</Text>
                  <Text style={styles.citationMeta}>{locatorLabel(citation.locator)}</Text>
                  <Text numberOfLines={3} style={styles.citationExcerpt}>{citation.excerpt}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ))}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      </ScrollView>
      <View style={styles.composer}>
        <TextInput
          accessibilityLabel="输入知识库问题"
          editable={!loading}
          maxLength={2_000}
          multiline
          onChangeText={setQuestion}
          placeholder="输入问题…"
          style={styles.input}
          value={question}
        />
        <Pressable
          accessibilityLabel="发送问题"
          accessibilityRole="button"
          accessibilityState={{ disabled: loading || !question.trim() }}
          disabled={loading || !question.trim()}
          onPress={() => void submit()}
          style={({ pressed }) => [styles.send, pressed && styles.pressed]}
        >
          <Ionicons color={colors.card} name={loading ? 'hourglass-outline' : 'arrow-up'} size={22} />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.card, flex: 1 },
  content: { gap: spacing.md, padding: spacing.md, paddingBottom: spacing.xl },
  hint: { ...typography.body, color: textColors.secondary, fontFamily: fontFamilies.sans, textAlign: 'center' },
  turn: { gap: spacing.sm },
  questionBubble: { alignSelf: 'flex-end', backgroundColor: colors.ink, borderRadius: radii.default, maxWidth: '88%', padding: spacing.md },
  questionText: { ...typography.body, color: colors.card, fontFamily: fontFamilies.sans },
  answerCard: { borderColor: colors.divider, borderRadius: radii.default, borderWidth: 1, gap: spacing.sm, padding: spacing.md },
  answerText: { ...typography.body, color: textColors.primary, fontFamily: fontFamilies.sans },
  citation: { backgroundColor: colors.background, borderRadius: radii.default, gap: spacing.xs, padding: spacing.sm },
  citationTitle: { ...typography.description, color: textColors.primary, fontFamily: fontFamilies.sansBold, fontWeight: 'bold' },
  citationMeta: { ...typography.label, color: textColors.secondary, fontFamily: fontFamilies.sans },
  citationExcerpt: { ...typography.description, color: textColors.secondary, fontFamily: fontFamilies.sans },
  error: { ...typography.body, color: '#b42318', fontFamily: fontFamilies.sans, textAlign: 'center' },
  composer: { alignItems: 'flex-end', borderTopColor: colors.divider, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: spacing.sm, padding: spacing.sm },
  input: { ...typography.body, borderColor: colors.divider, borderRadius: radii.default, borderWidth: 1, color: textColors.primary, flex: 1, fontFamily: fontFamilies.sans, maxHeight: 120, minHeight: 48, padding: spacing.sm },
  send: { alignItems: 'center', backgroundColor: colors.ink, borderRadius: 24, height: 48, justifyContent: 'center', width: 48 },
  pressed: { opacity: 0.72 },
});
