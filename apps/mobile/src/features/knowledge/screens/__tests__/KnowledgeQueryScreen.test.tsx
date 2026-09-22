/**
 * 可信知识问答页面测试。
 *
 * 验证即时发送、原位进度转换、失败重试、历史记录与引用导航。
 *
 * Responsibilities:
 * - 锁定用户可观察的消息生命周期。
 * - 确保历史面板保持只读且按需刷新。
 */
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { KeyboardAvoidingView, Platform, Text as MockText } from 'react-native';

import { KnowledgeQueryScreen } from '../KnowledgeQueryScreen';
import { listQueryHistory, listRetrievalCategoriesByBase, queryKnowledge } from '../../apiClient';
import { getKnowledgeCitationSource } from '@/shared/api/knowledgeBasesApi';
import { findRawTextViolations, type RenderedNode } from '../../testing/renderTextGuard';
import { colors } from '@/shared/theme/tokens';
import { document, knowledge } from '../../testing/fixtures';

jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));
jest.mock('../../apiClient');
jest.mock('@/shared/api/knowledgeBasesApi', () => ({
  ...jest.requireActual('@/shared/api/knowledgeBasesApi'),
  getKnowledgeCitationSource: jest.fn(),
}));
jest.mock('../../components/AnswerProgressCard', () => {
  return {
    AnswerProgressCard: ({ sourceCount }: { sourceCount?: number }) => (
      <MockText testID="knowledge-answer-progress">
        {sourceCount === undefined ? '动态处理中' : `已确认 ${sourceCount} 条引用来源`}
      </MockText>
    ),
  };
});

const response = {
  conversationId: '55555555-5555-4555-8555-555555555555',
  answer: '回答需要关联原始证据。[1]',
  grounded: true,
  citations: [
    {
      number: 1,
      knowledgeBaseId: knowledge.id,
      revisionId: '66666666-6666-4666-8666-666666666666',
      quoteSnapshot: document.chunks[0]!.content,
      documentId: document.id,
      documentTitle: document.title,
      chunkId: document.chunks[0]!.id,
      locator: document.chunks[0]!.locator,
      excerpt: document.chunks[0]!.content,
    },
  ],
  usage: { embeddingTokens: 4, rerankTokens: 6, inputTokens: 12, outputTokens: 8 },
  retrieval: { rerankStatus: 'applied' as const, rerankerModel: 'qwen3.7-text-rerank' },
};

function setPlatform(os: 'android' | 'ios' | 'web') {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: os });
}

describe('KnowledgeQueryScreen', () => {
  beforeEach(() => {
    setPlatform('android');
    jest.useFakeTimers();
    jest.mocked(listQueryHistory).mockResolvedValue({ items: [] });
    jest.mocked(listRetrievalCategoriesByBase).mockResolvedValue({ categories: [], failed: 0 });
    jest.mocked(getKnowledgeCitationSource).mockResolvedValue({ status: 'active' });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.resetAllMocks();
  });

  it('preselects every active retrieval category when entering from a group', async () => {
    jest.mocked(listRetrievalCategoriesByBase).mockResolvedValue({
      failed: 0,
      categories: [
        { id: 'cat-1', name: '产品资料', active: true, knowledgeBaseId: knowledge.id },
        { id: 'cat-2', name: '业务规则', active: true, knowledgeBaseId: knowledge.id },
        { id: 'cat-3', name: '旧类别', active: false, knowledgeBaseId: knowledge.id },
      ],
    } as never);
    const screen = render(
      <KnowledgeQueryScreen
        knowledgeId={knowledge.id}
        knowledgeBases={[{ id: knowledge.id, name: '产品研究知识库' }]}
        onBack={jest.fn()}
        onOpenCitation={jest.fn()}
        preselectCategories
      />,
    );

    await waitFor(() =>
      expect(listRetrievalCategoriesByBase).toHaveBeenCalledWith([
        { id: knowledge.id, name: '产品研究知识库' },
      ]),
    );
    // 默认勾选全部启用类别，停用类别不进入默认筛选。
    await waitFor(() => expect(screen.getByText('检索类别: 产品资料 / 业务规则')).toBeTruthy());
  });

  it('retrieves across every linked knowledge base by default', async () => {
    const secondBase = { id: '22222222-2222-4222-8222-222222222222', name: '术语知识库' };
    jest.mocked(listRetrievalCategoriesByBase).mockResolvedValue({
      failed: 0,
      categories: [
        { id: 'cat-1', name: '业务规则', active: true, knowledgeBaseId: knowledge.id },
        { id: 'cat-2', name: '术语纠错', active: true, knowledgeBaseId: secondBase.id },
      ],
    } as never);
    jest.mocked(queryKnowledge).mockResolvedValue(response);
    const screen = render(
      <KnowledgeQueryScreen
        knowledgeId={knowledge.id}
        knowledgeBases={[{ id: knowledge.id, name: '产品研究知识库' }, secondBase]}
        onBack={jest.fn()}
        onOpenCitation={jest.fn()}
        preselectCategories
      />,
    );

    await waitFor(() => expect(screen.getByText('参与检索的知识库：2 个')).toBeTruthy());
    fireEvent.changeText(screen.getByLabelText('输入知识库问题'), '两个库都问');
    fireEvent.press(screen.getByLabelText('发送问题'));
    await act(async () => Promise.resolve());
    act(() => jest.advanceTimersByTime(420));

    // 跨库范围与合并后的类别一起提交，顺序按字典序规范化。
    expect(queryKnowledge).toHaveBeenCalledWith(
      knowledge.id,
      '两个库都问',
      undefined,
      ['cat-1', 'cat-2'].sort(),
      [knowledge.id, secondBase.id].sort(),
    );
  });

  it('shows a non-blocking notice when reranking falls back to vector order', async () => {
    jest.mocked(queryKnowledge).mockResolvedValue({
      ...response,
      retrieval: {
        rerankStatus: 'fallback',
        rerankerModel: 'qwen3.7-text-rerank',
      },
    });
    const screen = render(
      <KnowledgeQueryScreen
        knowledgeId={knowledge.id}
        onBack={jest.fn()}
        onOpenCitation={jest.fn()}
      />,
    );

    fireEvent.changeText(screen.getByLabelText('输入知识库问题'), '发生降级时仍要回答');
    fireEvent.press(screen.getByLabelText('发送问题'));
    await act(async () => Promise.resolve());
    act(() => jest.advanceTimersByTime(420));

    expect(screen.getByText('智能重排暂时不可用，本次已使用向量检索结果继续回答。')).toBeTruthy();
    expect(screen.getByLabelText('1条引用来源')).toBeTruthy();
  });

  it('discloses the applied rerank and its measured effect', async () => {
    jest.mocked(queryKnowledge).mockResolvedValue({
      ...response,
      rerank: {
        status: 'applied',
        model: 'qwen3.7-text-rerank',
        candidateCount: 20,
        selectedCount: 5,
        promotedCount: 2,
        reordered: true,
        measured: true,
        durationMs: 380,
        tokens: 12,
        fallbackReason: null,
      },
    });
    const screen = render(
      <KnowledgeQueryScreen
        knowledgeId={knowledge.id}
        onBack={jest.fn()}
        onOpenCitation={jest.fn()}
      />,
    );

    fireEvent.changeText(screen.getByLabelText('输入知识库问题'), '用了重排吗');
    fireEvent.press(screen.getByLabelText('发送问题'));
    await act(async () => Promise.resolve());
    act(() => jest.advanceTimersByTime(420));

    expect(screen.getByTestId('rerank-disclosure')).toBeTruthy();
    expect(
      screen.getByText(
        /已使用智能重排（qwen3\.7-text-rerank）对 20 条候选重新排序：入选 5 条证据，其中 2 条来自重排提升（380 ms）。/,
      ),
    ).toBeTruthy();
  });

  it('names the missing rerank configuration instead of a generic degradation', async () => {
    jest.mocked(queryKnowledge).mockResolvedValue({
      ...response,
      rerank: {
        status: 'fallback',
        model: 'qwen3.7-text-rerank',
        candidateCount: 20,
        selectedCount: 2,
        promotedCount: 0,
        reordered: false,
        measured: false,
        durationMs: 0,
        tokens: 0,
        fallbackReason: 'NOT_CONFIGURED',
      },
    });
    const screen = render(
      <KnowledgeQueryScreen
        knowledgeId={knowledge.id}
        onBack={jest.fn()}
        onOpenCitation={jest.fn()}
      />,
    );

    fireEvent.changeText(screen.getByLabelText('输入知识库问题'), '重排没配好吗');
    fireEvent.press(screen.getByLabelText('发送问题'));
    await act(async () => Promise.resolve());
    act(() => jest.advanceTimersByTime(420));

    expect(
      screen.getByText('重排已开启，但百炼业务空间或重排模型尚未配置，本次使用向量检索结果。'),
    ).toBeTruthy();
  });

  it.each([
    ['android', 'height'],
    ['ios', 'padding'],
    ['web', undefined],
  ] as const)('uses the expected keyboard behavior on %s', (os, behavior) => {
    setPlatform(os);

    const screen = render(
      <KnowledgeQueryScreen
        knowledgeId={knowledge.id}
        onBack={jest.fn()}
        onOpenCitation={jest.fn()}
      />,
    );

    expect(screen.UNSAFE_getByType(KeyboardAvoidingView).props.behavior).toBe(behavior);
  });

  it('freezes the retrieval scope once the chat has started', async () => {
    jest.mocked(queryKnowledge).mockResolvedValue(response);
    const screen = render(
      <KnowledgeQueryScreen
        knowledgeId={knowledge.id}
        onBack={jest.fn()}
        onOpenCitation={jest.fn()}
      />,
    );

    // 未开始提问时可自由调整检索范围。
    expect(
      screen.queryByText('本次问答已开始，检索类别已固定；退出后重新进入可重新选择。'),
    ).toBeNull();
    expect(screen.getByText('检索类别: 自动选择类别')).toBeTruthy();

    fireEvent.changeText(screen.getByLabelText('输入知识库问题'), '证据是什么？');
    fireEvent.press(screen.getByLabelText('发送问题'));
    await act(async () => Promise.resolve());
    act(() => jest.advanceTimersByTime(420));

    // 开始后提示检索范围已固定；筛选入口同时被禁用。
    expect(
      screen.getByText('本次问答已开始，检索类别已固定；退出后重新进入可重新选择。'),
    ).toBeTruthy();
    expect(
      screen.getByText('检索类别: 自动选择类别').parent?.parent?.props.accessibilityState,
    ).toMatchObject({ disabled: true });
  });

  it('sends the question immediately and replaces progress with the final answer', async () => {
    let resolveQuery!: (value: typeof response) => void;
    jest.mocked(queryKnowledge).mockReturnValue(
      new Promise((resolve) => {
        resolveQuery = resolve;
      }),
    );
    const onOpenCitation = jest.fn();
    const screen = render(
      <KnowledgeQueryScreen
        knowledgeId={knowledge.id}
        onBack={jest.fn()}
        onOpenCitation={onOpenCitation}
      />,
    );

    fireEvent.changeText(screen.getByLabelText('输入知识库问题'), '证据是什么？');
    fireEvent.press(screen.getByLabelText('发送问题'));

    expect(screen.getByLabelText('输入知识库问题').props.value).toBe('');
    expect(screen.getByText('证据是什么？')).toBeTruthy();
    expect(screen.getByText('动态处理中')).toBeTruthy();

    await act(async () => {
      resolveQuery(response);
      await Promise.resolve();
    });
    expect(screen.getByText('已确认 1 条引用来源')).toBeTruthy();
    act(() => jest.advanceTimersByTime(420));
    expect(screen.getByText('回答需要关联原始证据。[1]')).toBeTruthy();

    fireEvent.press(screen.getByText(`[1] ${document.title}`));
    expect(onOpenCitation).not.toHaveBeenCalled();
    fireEvent.press(await screen.findByText('查看当前原文'));
    expect(onOpenCitation).toHaveBeenCalledWith(document.id, document.chunks[0]?.id);
  });

  it('keeps a failed user message and retries the same turn without duplication', async () => {
    jest
      .mocked(queryKnowledge)
      .mockRejectedValueOnce(new Error('网络暂时不可用'))
      .mockResolvedValueOnce(response);
    const screen = render(
      <KnowledgeQueryScreen
        knowledgeId={knowledge.id}
        onBack={jest.fn()}
        onOpenCitation={jest.fn()}
      />,
    );

    fireEvent.changeText(screen.getByLabelText('输入知识库问题'), '请重试这个问题');
    fireEvent.press(screen.getByLabelText('发送问题'));
    expect(await screen.findByText('网络暂时不可用')).toBeTruthy();

    fireEvent.press(screen.getByText('重新尝试'));
    await act(async () => Promise.resolve());
    act(() => jest.advanceTimersByTime(420));

    expect(screen.getAllByText('请重试这个问题')).toHaveLength(1);
    expect(queryKnowledge).toHaveBeenNthCalledWith(
      2,
      knowledge.id,
      '请重试这个问题',
      undefined,
      undefined,
      [knowledge.id],
    );
    expect(screen.getByText(response.answer)).toBeTruthy();
  });

  it('scrolls and highlights the matching card when an answer marker is pressed', async () => {
    const citedAnswer = '第一条结论成立[1]，第五条结论来自另一份资料[5]。';
    const longResponse = {
      ...response,
      answer: citedAnswer,
      citations: [
        ...response.citations,
        ...Array.from({ length: 5 }, (_, index) => {
          const number = index + 2;
          const chunk = document.chunks[0]!;
          return {
            ...response.citations[0]!,
            number,
            chunkId: `33333333-3333-4333-8333-${String(number).padStart(12, '0')}`,
            documentTitle: `来源 ${number}`,
            excerpt: chunk.content,
            locator: chunk.locator,
          };
        }),
      ],
    };
    jest.mocked(queryKnowledge).mockResolvedValue(longResponse);
    const screen = render(
      <KnowledgeQueryScreen
        knowledgeId={knowledge.id}
        onBack={jest.fn()}
        onOpenCitation={jest.fn()}
      />,
    );

    fireEvent.changeText(screen.getByLabelText('输入知识库问题'), '第五份资料说了什么？');
    fireEvent.press(screen.getByLabelText('发送问题'));
    await act(async () => Promise.resolve());
    act(() => jest.advanceTimersByTime(420));

    // 折叠状态下只展示前四条，因此第五张卡片必须在跳转时展开并高亮。
    expect(screen.queryByText('[5] 来源 5')).toBeNull();
    const cardTitles = [
      `[1] ${document.title}`,
      ...Array.from({ length: 5 }, (_, index) => `[${index + 2}] 来源 ${index + 2}`),
    ];
    const listContainer = screen.getByText(cardTitles[0]!).parent?.parent?.parent;

    act(() => fireEvent.press(screen.getByText('[5]')));
    expect(screen.getByText('[5] 来源 5')).toBeTruthy();

    // 正文标记按编号高亮对应卡片：滚动偏移的换算由 useCitationJump 单测锁定。
    const cardNodes = screen
      .UNSAFE_getAllByProps({ accessibilityRole: 'link' })
      .filter(
        (node) =>
          typeof node.props.onLayout === 'function' && typeof node.props.onPress === 'function',
      );
    const highlighted = cardNodes.filter((node) =>
      (Array.isArray(node.props.style) ? node.props.style : [node.props.style]).some(
        (style) => style?.backgroundColor === colors.primarySurface,
      ),
    );
    expect(highlighted).toHaveLength(1);
    expect(within(highlighted[0]!).getByText('[5] 来源 5')).toBeTruthy();

    fireEvent(listContainer!, 'layout', { nativeEvent: { layout: { y: 300 } } });
    for (const title of cardTitles.slice(0, 5)) {
      fireEvent(screen.getByText(title).parent?.parent!, 'layout', {
        nativeEvent: { layout: { height: 40, y: 0 } },
      });
    }
    act(() => jest.runOnlyPendingTimers());
  });

  it('loads the latest six completed questions through the read-only history action', async () => {
    jest.mocked(listQueryHistory).mockResolvedValue({
      items: [
        {
          id: '66666666-6666-4666-8666-666666666666',
          conversationId: response.conversationId,
          question: '历史问题',
          answer: '历史回答',
          grounded: true,
          citationCount: 2,
          citations: response.citations,
          createdAt: '2026-08-20T12:00:00.000Z',
        },
      ],
    });
    const onOpenCitation = jest.fn();
    const screen = render(
      <KnowledgeQueryScreen
        knowledgeId={knowledge.id}
        onBack={jest.fn()}
        onOpenCitation={onOpenCitation}
      />,
    );

    fireEvent.press(screen.getByLabelText('查看历史记录'));

    expect(await screen.findByText('历史问题')).toBeTruthy();
    expect(screen.getByText('历史回答')).toBeTruthy();
    expect(screen.getByText('2 条引用来源')).toBeTruthy();
    expect(screen.queryByText('重新发送')).toBeNull();
    expect(listQueryHistory).toHaveBeenCalledWith(knowledge.id);
    const historyItem = screen.getByTestId('query-history-item') as unknown as RenderedNode;
    expect(findRawTextViolations(historyItem)).toHaveLength(0);
    fireEvent.press(screen.getByText(`[1] ${document.title}`));
    fireEvent.press(await screen.findByText('查看当前原文'));
    expect(onOpenCitation).toHaveBeenCalledWith(document.id, document.chunks[0]?.id);
    expect(screen.queryByText('历史问题')).toBeNull();
  });

  it('marks history items that used reranking with the compact summary', async () => {
    jest.mocked(listQueryHistory).mockResolvedValue({
      items: [
        {
          id: '66666666-6666-4666-8666-666666666666',
          conversationId: response.conversationId,
          question: '历史重排问题',
          answer: '历史重排回答',
          grounded: true,
          citationCount: 2,
          citations: response.citations,
          createdAt: '2026-08-20T12:00:00.000Z',
          rerank: {
            status: 'applied',
            model: 'qwen3.7-text-rerank',
            candidateCount: 20,
            selectedCount: 5,
            promotedCount: 2,
            reordered: true,
            measured: true,
            durationMs: 380,
            tokens: 12,
            fallbackReason: null,
          },
        },
      ],
    });
    const screen = render(
      <KnowledgeQueryScreen
        knowledgeId={knowledge.id}
        onBack={jest.fn()}
        onOpenCitation={jest.fn()}
      />,
    );

    fireEvent.press(screen.getByLabelText('查看历史记录'));

    expect(await screen.findByText('智能重排 · 20 条候选 → 入选 5 条（2 条提升）')).toBeTruthy();
  });

  it('opens the history panel from the inline shortcut', async () => {
    jest.mocked(listQueryHistory).mockResolvedValue({
      items: [
        {
          id: '66666666-6666-4666-8666-666666666666',
          conversationId: response.conversationId,
          question: '快捷键历史问题',
          answer: '快捷键历史回答',
          grounded: true,
          citationCount: 0,
          createdAt: '2026-08-20T12:00:00.000Z',
        },
      ],
    });
    const screen = render(
      <KnowledgeQueryScreen
        knowledgeId={knowledge.id}
        onBack={jest.fn()}
        onOpenCitation={jest.fn()}
      />,
    );

    // 正文上方的“查看历史记录”标签必须可点击，而不是纯装饰文本。
    expect(screen.queryByText('快捷键历史问题')).toBeNull();
    fireEvent.press(screen.getByTestId('query-history-shortcut'));

    expect(await screen.findByText('快捷键历史问题')).toBeTruthy();
    expect(listQueryHistory).toHaveBeenCalledWith(knowledge.id);
  });
});
