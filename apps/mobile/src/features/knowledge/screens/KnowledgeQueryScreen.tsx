/**
 * 可信知识问答页面。
 *
 * 以消息轮次管理发送、动态等待、失败重试和最终可信回答，并提供只读历史与引用跳转。
 *
 * Responsibilities:
 * - 发送时立即创建用户消息并清空输入框。
 * - 将 Assistant 轮次从进度态原位转换为成功或失败态。
 * - 按需读取最近六个已完成问答。
 *
 * Notes:
 * - 进度阶段是客户端等待反馈；最终回答与引用仍只使用服务器完整 JSON。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type { RagHistoryItem, RagQueryResponse } from '@echowave/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PageHeader } from '@/shared/ui/PageHeader';
import { ScreenRefreshControl } from '@/shared/ui/ScreenRefreshControl';
import { useScreenRefresh } from '@/shared/hooks/useScreenRefresh';

import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';
import { listQueryHistory, queryKnowledge } from '../apiClient';
import { AnswerProgressCard } from '../components/AnswerProgressCard';
import { CitationList } from '../components/CitationList';
import { QueryHistoryModal } from '../components/QueryHistoryModal';

type Turn = {
  id: number;
  question: string;
} & (
  | { status: 'pending' }
  | { status: 'verified'; response: RagQueryResponse }
  | { status: 'completed'; response: RagQueryResponse }
  | { status: 'failed'; error: string }
);

/** 管理即时发送、动态反馈、只读历史和最终可信回答。 */
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
  const [activeTurnId, setActiveTurnId] = useState<number>();
  const [historyVisible, setHistoryVisible] = useState(false);
  const [historyItems, setHistoryItems] = useState<RagHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const nextTurnId = useRef(1);
  const mounted = useRef(true);
  const completionTimers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    const timers = completionTimers.current;
    mounted.current = true;
    return () => {
      mounted.current = false;
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, []);

  const scrollToLatest = useCallback(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, []);

  useEffect(() => {
    scrollToLatest();
  }, [scrollToLatest, turns]);

  const runTurn = async (turnId: number, value: string) => {
    try {
      const response = await queryKnowledge(knowledgeId, value, conversationId);
      if (!mounted.current) return;
      setConversationId(response.conversationId);
      setTurns((items) =>
        items.map((item) =>
          item.id === turnId
            ? { id: item.id, question: item.question, status: 'verified', response }
            : item,
        ),
      );
      // 短暂呈现可证实的引用数量，再把同一轮原位替换为最终回答。
      const timer = setTimeout(() => {
        completionTimers.current.delete(timer);
        if (!mounted.current) return;
        setTurns((items) =>
          items.map((item) =>
            item.id === turnId
              ? { id: item.id, question: item.question, status: 'completed', response }
              : item,
          ),
        );
        setActiveTurnId(undefined);
      }, 420);
      completionTimers.current.add(timer);
    } catch (reason) {
      if (!mounted.current) return;
      const message = reason instanceof Error ? reason.message : '问答请求失败。';
      setTurns((items) =>
        items.map((item) =>
          item.id === turnId
            ? { id: item.id, question: item.question, status: 'failed', error: message }
            : item,
        ),
      );
      setActiveTurnId(undefined);
    }
  };

  const submit = () => {
    const value = question.trim();
    if (!value || activeTurnId !== undefined) return;
    const turnId = nextTurnId.current;
    nextTurnId.current += 1;
    // 用户消息先进入本地会话，网络响应只更新这一轮的 Assistant 状态。
    setQuestion('');
    setTurns((items) => [...items, { id: turnId, question: value, status: 'pending' }]);
    setActiveTurnId(turnId);
    void runTurn(turnId, value);
  };

  const retryTurn = (turn: Turn) => {
    if (activeTurnId !== undefined) return;
    setTurns((items) =>
      items.map((item) =>
        item.id === turn.id ? { id: item.id, question: item.question, status: 'pending' } : item,
      ),
    );
    setActiveTurnId(turn.id);
    void runTurn(turn.id, turn.question);
  };

  const loadHistory = async () => {
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const history = await listQueryHistory(knowledgeId);
      if (mounted.current) setHistoryItems(history.items);
    } catch (reason) {
      if (mounted.current) {
        setHistoryError(reason instanceof Error ? reason.message : '历史记录加载失败。');
      }
    } finally {
      if (mounted.current) setHistoryLoading(false);
    }
  };
  const screenRefresh = useScreenRefresh(loadHistory);

  const openHistory = () => {
    setHistoryVisible(true);
    void loadHistory();
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <PageHeader moreLabel="查看历史记录" onBack={onBack} onMore={openHistory} title="问知识库" />
      <ScrollView
        alwaysBounceVertical
        contentContainerStyle={styles.content}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={scrollToLatest}
        ref={scrollRef}
        refreshControl={<ScreenRefreshControl {...screenRefresh} />}
      >
        {turns.length === 0 ? (
          <Text style={styles.hint}>回答只基于已完成解析的知识库文档；依据不足时会明确拒答。</Text>
        ) : null}
        {turns.map((turn) => (
          <View key={turn.id} style={styles.turn}>
            <View style={styles.questionBubble}>
              <Text selectable style={styles.questionText}>
                {turn.question}
              </Text>
            </View>
            {turn.status === 'pending' || turn.status === 'verified' ? (
              <AnswerProgressCard
                onProgressChange={scrollToLatest}
                sourceCount={
                  turn.status === 'verified' ? turn.response.citations.length : undefined
                }
              />
            ) : null}
            {turn.status === 'failed' ? (
              <View style={styles.failureCard}>
                <View style={styles.failureTitleRow}>
                  <Ionicons color="#b42318" name="alert-circle-outline" size={21} />
                  <Text style={styles.failureTitle}>请求未完成</Text>
                </View>
                <Text accessibilityRole="alert" style={styles.failureText}>
                  {turn.error}
                </Text>
                <Pressable
                  accessibilityLabel={`重新尝试：${turn.question}`}
                  accessibilityRole="button"
                  disabled={activeTurnId !== undefined}
                  onPress={() => retryTurn(turn)}
                  style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
                >
                  <Text style={styles.retryText}>重新尝试</Text>
                </Pressable>
              </View>
            ) : null}
            {turn.status === 'completed' ? (
              <View style={styles.answerCard}>
                <Text selectable style={styles.answerText}>
                  {turn.response.answer}
                </Text>
                <CitationList citations={turn.response.citations} onOpenCitation={onOpenCitation} />
              </View>
            ) : null}
          </View>
        ))}
      </ScrollView>
      <View style={styles.composer}>
        <TextInput
          accessibilityLabel="输入知识库问题"
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
          accessibilityState={{ disabled: activeTurnId !== undefined || !question.trim() }}
          disabled={activeTurnId !== undefined || !question.trim()}
          onPress={submit}
          style={({ pressed }) => [styles.send, pressed && styles.pressed]}
        >
          <Ionicons
            color={colors.card}
            name={activeTurnId !== undefined ? 'hourglass-outline' : 'arrow-up'}
            size={22}
          />
        </Pressable>
      </View>
      <QueryHistoryModal
        error={historyError}
        items={historyItems}
        loading={historyLoading}
        onClose={() => setHistoryVisible(false)}
        onRetry={() => void loadHistory()}
        visible={historyVisible}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.card, flex: 1 },
  content: { gap: spacing.md, padding: spacing.md, paddingBottom: spacing.xl },
  hint: {
    ...typography.body,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    textAlign: 'center',
  },
  turn: { gap: spacing.sm },
  questionBubble: {
    alignSelf: 'flex-end',
    backgroundColor: colors.ink,
    borderRadius: radii.default,
    maxWidth: '88%',
    padding: spacing.md,
  },
  questionText: { ...typography.body, color: colors.card, fontFamily: fontFamilies.sans },
  answerCard: {
    alignSelf: 'flex-start',
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    gap: spacing.sm,
    maxWidth: '92%',
    padding: spacing.md,
  },
  answerText: { ...typography.body, color: textColors.primary, fontFamily: fontFamilies.sans },
  failureCard: {
    alignSelf: 'flex-start',
    backgroundColor: '#fff4f2',
    borderColor: '#fecdca',
    borderRadius: radii.default,
    borderWidth: 1,
    gap: spacing.sm,
    maxWidth: '92%',
    padding: spacing.md,
  },
  failureTitleRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  failureTitle: {
    ...typography.heading5,
    color: '#b42318',
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  failureText: { ...typography.description, color: '#912018', fontFamily: fontFamilies.sans },
  retryButton: {
    alignSelf: 'flex-start',
    backgroundColor: colors.ink,
    borderRadius: radii.default,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  retryText: {
    ...typography.description,
    color: colors.card,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
  composer: {
    alignItems: 'flex-end',
    borderTopColor: colors.divider,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.sm,
  },
  input: {
    ...typography.body,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    color: textColors.primary,
    flex: 1,
    fontFamily: fontFamilies.sans,
    maxHeight: 120,
    minHeight: 48,
    padding: spacing.sm,
  },
  send: {
    alignItems: 'center',
    backgroundColor: colors.ink,
    borderRadius: 24,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  pressed: { opacity: 0.72 },
});
