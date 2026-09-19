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
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PageHeader } from '@/shared/ui/PageHeader';
import { GuideButton } from '@/shared/ui/GuideButton';
import { ScreenRefreshControl } from '@/shared/ui/ScreenRefreshControl';
import { useCitationJump } from '@/shared/hooks/useCitationJump';
import { useScreenRefresh } from '@/shared/hooks/useScreenRefresh';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import { useStarterTourTarget } from '@/shared/onboarding/StarterTourContext';

import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';
import { textInputText } from '@/shared/theme/textInput';
import { listQueryHistory, listRetrievalCategoriesByBase, queryKnowledge } from '../apiClient';
import { AnswerProgressCard } from '../components/AnswerProgressCard';
import { AnswerText } from '../components/AnswerText';
import { CitationList, type CitationListHandle } from '../components/CitationList';
import { CategoryQueryFilter } from '../components/CategoryQueryFilter';
import { QueryHistoryModal } from '../components/QueryHistoryModal';
import { GuideDemoBanner } from '../components/GuideDemoBanner';
import { guideDemoQueryResponse } from '../guideDemoData';

type Turn = {
  id: number;
  question: string;
  categoryIds?: string[];
  /** 该轮实际参与检索的知识库集合，重试时沿用同一范围。 */
  knowledgeBaseIds?: string[];
} & (
  | { status: 'pending' }
  | { status: 'verified'; response: RagQueryResponse }
  | { status: 'completed'; response: RagQueryResponse }
  | { status: 'failed'; error: string }
);

/** 知识库集合的稳定标识，用于避免列表身份变化触发重复预选。 */
function knowledgeBaseKey(bases?: { id: string }[]) {
  return bases?.map((base) => base.id).join(',') ?? '';
}

/** 管理即时发送、动态反馈、只读历史和最终可信回答。 */
export function KnowledgeQueryScreen({
  guideDemo = false,
  knowledgeId,
  onBack,
  onOpenCitation,
  preselectCategories = false,
  knowledgeBases,
  /** 本次进入的唯一标识，仅用于让页面在重新进入时重新开始。 */
  sessionId,
}: {
  guideDemo?: boolean;
  knowledgeId: string;
  onBack: () => void;
  onOpenCitation: (documentId: string, chunkId: string) => void;
  /** 从分组入口进入时默认勾选全部参与检索知识库的可检索类别。 */
  preselectCategories?: boolean;
  /**
   * 参与检索的知识库集合（含名称）。
   *
   * 超过一个库时启用跨库检索：默认全部参与，用户可在类别面板里按库取消。
   */
  knowledgeBases?: { id: string; name: string }[];
  sessionId?: string;
}) {
  const { t } = useAppLanguage();
  const headerTargetRef = useStarterTourTarget('query-header');
  const hintTargetRef = useStarterTourTarget('query-hint');
  const composerTargetRef = useStarterTourTarget('query-composer');
  const historyTargetRef = useStarterTourTarget('query-history');
  const answerTargetRef = useStarterTourTarget('query-answer');
  const citationTargetRef = useStarterTourTarget('query-citation');
  const [question, setQuestion] = useState('');
  const [conversationId, setConversationId] = useState<string>();
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  /** 被用户取消参与检索的知识库；其余知识库默认参与跨库检索。 */
  const [excludedKnowledgeBaseIds, setExcludedKnowledgeBaseIds] = useState<string[]>([]);
  const [turns, setTurns] = useState<Turn[]>(
    guideDemo
      ? [
          {
            id: 1,
            question: '复盘规范中需要保留什么证据？',
            response: guideDemoQueryResponse,
            status: 'completed',
          },
        ]
      : [],
  );
  const [activeTurnId, setActiveTurnId] = useState<number>();
  const [historyVisible, setHistoryVisible] = useState(false);
  const [historyItems, setHistoryItems] = useState<RagHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const nextTurnId = useRef(1);
  const mounted = useRef(true);
  const completionTimers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const scrollRef = useRef<ScrollView>(null);
  const citationListRefs = useRef(new Map<number, CitationListHandle | null>());
  const answerContainerOffsets = useRef(new Map<number, number>());
  const jump = useCitationJump(scrollRef);
  /** 标记跳转期间暂停自动滚到底部，避免与跳转目标互相打断。 */
  const skipAutoScrollUntil = useRef(0);

  const registerCitationList = useCallback(
    (turnId: number) => (node: CitationListHandle | null) => {
      citationListRefs.current.set(turnId, node);
    },
    [],
  );
  const guideDemoHistory: RagHistoryItem[] = [
    {
      id: '00000000-0000-4000-8000-000000000006',
      conversationId: guideDemoQueryResponse.conversationId,
      question: '复盘规范中需要保留什么证据？',
      answer: guideDemoQueryResponse.answer,
      grounded: true,
      citationCount: guideDemoQueryResponse.citations.length,
      createdAt: '2026-09-01T10:05:00.000Z',
    },
  ];

  useEffect(() => {
    const timers = completionTimers.current;
    mounted.current = true;
    return () => {
      mounted.current = false;
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, []);

  // 分组入口默认勾选参与检索的全部启用类别；失败时保持自动路由，不阻塞提问。
  const knowledgeBaseIdsKey = knowledgeBaseKey(knowledgeBases);
  useEffect(() => {
    if (!preselectCategories || guideDemo || !knowledgeId) return;
    let active = true;
    const bases = knowledgeBases?.length ? knowledgeBases : [{ id: knowledgeId, name: '' }];
    void listRetrievalCategoriesByBase(bases)
      .then((result) => {
        if (!active) return;
        const ids = result.categories.filter((item) => item.active).map((item) => item.id);
        if (ids.length) setCategoryIds(ids);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
    // knowledgeBases 由 knowledgeBaseIdsKey 完整标识，避免数组身份变化触发重复请求。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guideDemo, knowledgeBaseIdsKey, knowledgeId, preselectCategories]);

  const scrollToLatest = useCallback(() => {
    if (Date.now() < skipAutoScrollUntil.current) return;
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, []);

  useEffect(() => {
    scrollToLatest();
  }, [scrollToLatest, turns]);

  /** 引用列表完成布局后的回调：把卡片位置换算成页面滚动位置。 */
  const scrollToCitationCard = useCallback(
    (turnId: number, offset: number) => {
      const containerOffset = answerContainerOffsets.current.get(turnId);
      if (containerOffset === undefined) return;
      skipAutoScrollUntil.current = Date.now() + 1_200;
      jump.onCitationScrollToOffset(containerOffset + offset);
    },
    [jump],
  );

  /** 正文标记点击：先高亮，再让引用列表在展开完成后回报卡片位置。 */
  const openCitationMarker = useCallback(
    (turnId: number, number: number) => {
      skipAutoScrollUntil.current = Date.now() + 1_200;
      jump.openCitation(number);
      citationListRefs.current.get(turnId)?.scrollToCitation(number);
    },
    [jump],
  );

  const runTurn = async (
    turnId: number,
    value: string,
    selectedCategories?: string[],
    selectedBaseIds?: string[],
  ) => {
    if (guideDemo) return;
    try {
      const response = await queryKnowledge(
        knowledgeId,
        value,
        conversationId,
        selectedCategories,
        selectedBaseIds,
      );
      if (!mounted.current) return;
      setConversationId(response.conversationId);
      setTurns((items) =>
        items.map((item) =>
          item.id === turnId ? { ...item, status: 'verified', response } : item,
        ),
      );
      // 短暂呈现可证实的引用数量，再把同一轮原位替换为最终回答。
      const timer = setTimeout(() => {
        completionTimers.current.delete(timer);
        if (!mounted.current) return;
        setTurns((items) =>
          items.map((item) =>
            item.id === turnId ? { ...item, status: 'completed', response } : item,
          ),
        );
        setActiveTurnId(undefined);
      }, 420);
      completionTimers.current.add(timer);
    } catch (reason) {
      if (!mounted.current) return;
      const message = reason instanceof Error ? reason.message : t('knowledgeQuery.failed');
      setTurns((items) =>
        items.map((item) =>
          item.id === turnId ? { ...item, status: 'failed', error: message } : item,
        ),
      );
      setActiveTurnId(undefined);
    }
  };

  const submit = () => {
    if (guideDemo) return;
    const value = question.trim();
    if (!value || activeTurnId !== undefined) return;
    const turnId = nextTurnId.current;
    nextTurnId.current += 1;
    // 用户消息先进入本地会话，网络响应只更新这一轮的 Assistant 状态。
    setQuestion('');
    const selectedCategories = categoryIds.length ? [...categoryIds] : undefined;
    const selectedBaseIds = activeKnowledgeBaseIds;
    setTurns((items) => [
      ...items,
      {
        id: turnId,
        question: value,
        status: 'pending',
        categoryIds: selectedCategories,
        knowledgeBaseIds: selectedBaseIds,
      },
    ]);
    setActiveTurnId(turnId);
    void runTurn(turnId, value, selectedCategories, selectedBaseIds);
  };

  const retryTurn = (turn: Turn) => {
    if (activeTurnId !== undefined) return;
    setTurns((items) =>
      items.map((item) => (item.id === turn.id ? { ...item, status: 'pending' } : item)),
    );
    setActiveTurnId(turn.id);
    void runTurn(turn.id, turn.question, turn.categoryIds, turn.knowledgeBaseIds);
  };

  const loadHistory = async () => {
    if (guideDemo) {
      setHistoryItems(guideDemoHistory);
      setHistoryError('');
      setHistoryLoading(false);
      return;
    }
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const history = await listQueryHistory(knowledgeId);
      if (mounted.current) setHistoryItems(history.items);
    } catch (reason) {
      if (mounted.current) {
        setHistoryError(
          reason instanceof Error ? reason.message : t('knowledgeQuery.historyFailed'),
        );
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

  /** 本段聊天是否已经开始：开始后冻结检索范围，重新进入才会重新开始。 */
  const chatStarted = turns.length > 0;

  /** 参与本次检索的知识库集合：路由库必选，其余关联库去掉被用户取消的项。 */ const activeKnowledgeBaseIds =
    [
      ...new Set([
        knowledgeId,
        ...(knowledgeBases?.map((base) => base.id) ?? []).filter(
          (id) => !excludedKnowledgeBaseIds.includes(id),
        ),
      ]),
    ].sort();

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={
          Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined
        }
        style={styles.flex}
      >
        <View ref={headerTargetRef} collapsable={false}>
          <PageHeader
            guide={
              <GuideButton
                content={{
                  guide: 'knowledge_query',
                  kind: 'tour',
                  returnTo: `/knowledge/${knowledgeId}/ask`,
                }}
                testID="knowledge-query-guide"
              />
            }
            moreLabel={t('knowledgeQuery.history')}
            onBack={onBack}
            onMore={openHistory}
            title={t('knowledgeQuery.title')}
          />
        </View>
        {guideDemo ? <GuideDemoBanner /> : null}
        {!guideDemo ? (
          <>
            <CategoryQueryFilter
              knowledgeId={knowledgeId}
              knowledgeBases={knowledgeBases}
              excludedKnowledgeBaseIds={excludedKnowledgeBaseIds}
              onToggleKnowledgeBase={(id) =>
                setExcludedKnowledgeBaseIds((current) =>
                  current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
                )
              }
              selected={categoryIds}
              onChange={setCategoryIds}
              disabled={activeTurnId !== undefined || chatStarted}
            />
            {chatStarted ? (
              <Text style={styles.frozenNotice}>{t('knowledgeQuery.scopeFrozen')}</Text>
            ) : null}
          </>
        ) : null}
        <ScrollView
          alwaysBounceVertical
          contentContainerStyle={styles.content}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={scrollToLatest}
          ref={scrollRef}
          refreshControl={<ScreenRefreshControl {...screenRefresh} />}
          style={styles.flex}
        >
          <View ref={hintTargetRef} collapsable={false}>
            <Text style={styles.hint}>{t('knowledgeQuery.hint')}</Text>
          </View>
          <Pressable
            accessibilityLabel={t('knowledgeQuery.historyShortcut')}
            accessibilityRole="button"
            onPress={openHistory}
            ref={historyTargetRef}
            style={({ pressed }) => [styles.historyHint, pressed && styles.pressed]}
            testID="query-history-shortcut"
          >
            <Text style={styles.historyHintText}>{t('knowledgeQuery.history')}</Text>
          </Pressable>
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
                    <Text style={styles.failureTitle}>{t('knowledgeQuery.incomplete')}</Text>
                  </View>
                  <Text accessibilityRole="alert" style={styles.failureText}>
                    {turn.error}
                  </Text>
                  <Pressable
                    accessibilityLabel={t('knowledgeQuery.retryAccessibility', {
                      question: turn.question,
                    })}
                    accessibilityRole="button"
                    disabled={activeTurnId !== undefined}
                    onPress={() => retryTurn(turn)}
                    style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
                  >
                    <Text style={styles.retryText}>{t('knowledgeQuery.retry')}</Text>
                  </Pressable>
                </View>
              ) : null}
              {turn.status === 'completed' ? (
                <View
                  accessibilityLabel={turn.response.citations.length + '条引用来源'}
                  ref={answerTargetRef}
                  onLayout={(event) => {
                    answerContainerOffsets.current.set(turn.id, event.nativeEvent.layout.y);
                  }}
                  style={styles.answerCard}
                >
                  <AnswerText
                    answer={turn.response.answer}
                    citationCount={turn.response.citations.length}
                    onOpenCitationMarker={(number) => openCitationMarker(turn.id, number)}
                    style={styles.answerText}
                  />
                  <View
                    collapsable={false}
                    onLayout={(event) => jump.setListOffset(event.nativeEvent.layout.y)}
                    ref={citationTargetRef}
                  >
                    <CitationList
                      citations={turn.response.citations}
                      highlightedNumber={jump.highlightedNumber}
                      onOpenCitation={onOpenCitation}
                      onScrollToOffset={(offset) => scrollToCitationCard(turn.id, offset)}
                      ref={registerCitationList(turn.id)}
                    />
                  </View>
                </View>
              ) : null}
            </View>
          ))}
        </ScrollView>
        <View ref={composerTargetRef} collapsable={false} style={styles.composer}>
          <TextInput
            accessibilityLabel={t('knowledgeQuery.input')}
            maxLength={2_000}
            multiline
            onChangeText={setQuestion}
            placeholder={t('knowledgeQuery.placeholder')}
            style={styles.input}
            value={question}
          />
          <Pressable
            accessibilityLabel={t('knowledgeQuery.send')}
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
      </KeyboardAvoidingView>
      <QueryHistoryModal
        knowledgeId={knowledgeId}
        onOpenCitation={onOpenCitation}
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
  flex: { flex: 1 },
  content: { gap: spacing.md, padding: spacing.md, paddingBottom: spacing.xl },
  hint: {
    ...typography.body,
    color: textColors.secondary,
    fontFamily: fontFamilies.sans,
    textAlign: 'center',
  },
  historyHint: {
    alignSelf: 'flex-end',
    backgroundColor: colors.background,
    borderRadius: radii.default,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  historyHintText: { ...typography.description, color: textColors.secondary },
  // 检索范围冻结提示：说明本段聊天内不可修改，退出后重新进入才会重新开始。
  frozenNotice: {
    ...typography.label,
    color: textColors.tertiary,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xs,
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
  // 单行问题框，输入变长时升高到 120 为止；光标与文字保持居中行盒。
  input: {
    ...typography.body,
    ...textInputText,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: 1,
    color: textColors.primary,
    flex: 1,
    fontFamily: fontFamilies.sans,
    maxHeight: 120,
    minHeight: 48,
    paddingHorizontal: spacing.sm,
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
