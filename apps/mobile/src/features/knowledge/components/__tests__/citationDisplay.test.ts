/**
 * 答案正文引用标记拆分测试。
 *
 * 验证只有落在可见引用清单范围内的 [n] 才会变成可跳转片段。
 *
 * Responsibilities:
 * - 锁定标记识别范围与纯文本回退语义。
 */
import { splitAnswerCitations } from '../citationDisplay';

describe('splitAnswerCitations', () => {
  it('splits in-range markers into citation segments', () => {
    const segments = splitAnswerCitations('结论依据来自第一份资料[1]，补充见第三份[3]。', 3);

    expect(segments.map((segment) => segment.kind)).toEqual([
      'text',
      'citation',
      'text',
      'citation',
      'text',
    ]);
    expect(
      segments
        .filter((segment) => segment.kind === 'citation')
        .map((segment) => (segment.kind === 'citation' ? segment.number : 0)),
    ).toEqual([1, 3]);
  });

  it('keeps out-of-range markers as plain text', () => {
    const segments = splitAnswerCitations('结论[1]，越界编号[9]不可点击。', 2);

    expect(segments.filter((segment) => segment.kind === 'citation')).toHaveLength(1);
    expect(
      segments.some((segment) => segment.kind === 'text' && segment.text.includes('[9]')),
    ).toBe(true);
  });

  it('returns a single text segment when there is no citation', () => {
    const segments = splitAnswerCitations('知识库中没有足够依据回答这个问题。', 0);

    expect(segments).toEqual([
      { kind: 'text', key: 'text-0', text: '知识库中没有足够依据回答这个问题。' },
    ]);
  });
});
