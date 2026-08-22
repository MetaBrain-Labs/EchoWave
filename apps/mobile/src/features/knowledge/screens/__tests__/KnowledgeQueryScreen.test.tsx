/**
 * 可信知识问答页面测试。
 *
 * 验证即时发送、原位进度转换、失败重试、历史记录与引用导航。
 *
 * Responsibilities:
 * - 锁定用户可观察的消息生命周期。
 * - 确保历史面板保持只读且按需刷新。
 */
import { act, fireEvent, render } from '@testing-library/react-native';
import { Text as MockText } from 'react-native';

import { KnowledgeQueryScreen } from '../KnowledgeQueryScreen';
import { listQueryHistory, queryKnowledge } from '../../apiClient';
import { document, knowledge } from '../../testing/fixtures';

jest.mock('../../apiClient');
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
      documentId: document.id,
      documentTitle: document.title,
      chunkId: document.chunks[0]!.id,
      locator: document.chunks[0]!.locator,
      excerpt: document.chunks[0]!.content,
    },
  ],
  usage: { embeddingTokens: 4, inputTokens: 12, outputTokens: 8 },
};

describe('KnowledgeQueryScreen', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.mocked(listQueryHistory).mockResolvedValue({ items: [] });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.resetAllMocks();
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

    fireEvent.press(screen.getByLabelText('查看历史记录'));

    expect(await screen.findByText('历史问题')).toBeTruthy();
    expect(screen.getByText('历史回答')).toBeTruthy();
    expect(screen.getByText('2 条引用来源')).toBeTruthy();
    expect(screen.queryByText('重新发送')).toBeNull();
    expect(listQueryHistory).toHaveBeenCalledWith(knowledge.id);
  });
});
