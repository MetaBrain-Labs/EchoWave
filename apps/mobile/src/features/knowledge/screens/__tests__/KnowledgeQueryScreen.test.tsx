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
import { listQueryHistory, listRetrievalCategories, queryKnowledge } from '../../apiClient';
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
  usage: { embeddingTokens: 4, inputTokens: 12, outputTokens: 8 },
};

function setPlatform(os: 'android' | 'ios' | 'web') {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: os });
}

describe('KnowledgeQueryScreen', () => {
  beforeEach(() => {
    setPlatform('android');
    jest.useFakeTimers();
    jest.mocked(listQueryHistory).mockResolvedValue({ items: [] });
    jest.mocked(listRetrievalCategories).mockResolvedValue({ items: [] });
    jest.mocked(getKnowledgeCitationSource).mockResolvedValue({ status: 'active' });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.resetAllMocks();
  });

  it('preselects every active retrieval category when entering from a group', async () => {
    jest.mocked(listRetrievalCategories).mockResolvedValue({
      items: [
        { id: 'cat-1', name: '产品资料', active: true },
        { id: 'cat-2', name: '业务规则', active: true },
        { id: 'cat-3', name: '旧类别', active: false },
      ],
    } as never);
    const screen = render(
      <KnowledgeQueryScreen
        knowledgeId={knowledge.id}
        onBack={jest.fn()}
        onOpenCitation={jest.fn()}
        preselectCategories
      />,
    );

    await waitFor(() => expect(listRetrievalCategories).toHaveBeenCalledWith(knowledge.id));
    // 默认勾选全部启用类别，停用类别不进入默认筛选。
    await waitFor(() => expect(screen.getByText('检索类别: 产品资料 / 业务规则')).toBeTruthy());
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
    expect(queryKnowledge).toHaveBeenNthCalledWith(2, knowledge.id, '请重试这个问题', undefined);
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
