/**
 * 回答引用标记规范化。
 *
 * 把模型答案正文中的 [n] 标记与服务端已验证的引用集合对齐：移除超出引用数量的悬空标记，
 * 按正文首次出现顺序重排引用，并把标记重编为连续的 1..N。
 *
 * Responsibilities:
 * - 解析答案正文中的数字引用标记。
 * - 返回重编后的正文、按正文顺序排列的引用 ID 以及被移除的标记数量。
 *
 * Notes:
 * - 纯函数，不访问数据库、日志或模型。
 * - 只把 ASCII 方括号数字视为标记；代码块内的标记同样按普通文本处理。
 * - 对已连续编号且顺序一致的正文是幂等的。
 */

/** 答案正文中的一个标记片段或普通文本片段。 */
type AnswerSegment = { kind: 'text'; text: string } | { kind: 'marker'; number: number };

/** 规范化结果，供可信回答模块直接组装响应与审计元数据。 */
export type ResolvedCitationMarkers = {
  /** 已重编标记的答案正文。 */
  answer: string;
  /** 按正文首次出现顺序排列、且只包含有效标记的引用 ID。 */
  citationIds: string[];
  /** 因超出引用数量而被移除的标记数量。 */
  droppedMarkerCount: number;
};

const MARKER_PATTERN = /\[(\d+)\]/g;

/** 按规定顺序列出答案正文中的引用编号。 */
export function answerCitationNumbers(answer: string): number[] {
  return [...answer.matchAll(MARKER_PATTERN)].map((match) => Number(match[1]));
}

function parseSegments(text: string): AnswerSegment[] {
  const segments: AnswerSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(MARKER_PATTERN)) {
    const start = match.index;
    if (start > cursor) segments.push({ kind: 'text', text: text.slice(cursor, start) });
    segments.push({ kind: 'marker', number: Number(match[1]) });
    cursor = start + match[0].length;
  }
  if (cursor < text.length) segments.push({ kind: 'text', text: text.slice(cursor) });
  return segments;
}

/**
 * 把答案标记与已校验引用集合对齐。
 *
 * 模型标记按 1 基序号对应引用顺序；超出引用数量的标记与正文都不可追溯，因此一并移除。
 * 未在正文出现的引用会被保留并追加在末尾，保证来源清单完整。
 */
export function resolveCitationMarkers(
  answer: string,
  citationIds: string[],
): ResolvedCitationMarkers {
  const segments = parseSegments(answer);

  // 无引用回答不允许残留标记，避免出现指向空清单的引用编号。
  if (!citationIds.length) {
    return {
      answer: segments.map((segment) => (segment.kind === 'text' ? segment.text : '')).join(''),
      citationIds: [],
      droppedMarkerCount: segments.filter((segment) => segment.kind === 'marker').length,
    };
  }

  const mentionedIndexes: number[] = [];
  const renumbered = new Map<number, number>();
  let droppedMarkerCount = 0;
  for (const segment of segments) {
    if (segment.kind !== 'marker') continue;
    if (segment.number < 1 || segment.number > citationIds.length) {
      droppedMarkerCount += 1;
      continue;
    }
    if (!renumbered.has(segment.number)) {
      renumbered.set(segment.number, mentionedIndexes.length + 1);
      mentionedIndexes.push(segment.number);
    }
  }

  // 模型可能完全没有按标记写出引用，此时保持引用原顺序，正文中的悬空标记同样被移除。
  const mentioned = new Set(mentionedIndexes);
  const orderedIds = mentionedIndexes.length
    ? mentionedIndexes.map((number) => citationIds[number - 1]!)
    : [...citationIds];
  const unmentionedIds = mentionedIndexes.length
    ? citationIds.filter((_, index) => !mentioned.has(index + 1))
    : [];

  return {
    answer: segments
      .map((segment) =>
        segment.kind === 'text'
          ? segment.text
          : renumbered.has(segment.number)
            ? `[${renumbered.get(segment.number)}]`
            : '',
      )
      .join(''),
    citationIds: [...orderedIds, ...unmentionedIds],
    droppedMarkerCount,
  };
}
