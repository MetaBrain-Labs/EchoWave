/**
 * 引用列表展示辅助。
 *
 * 把服务器返回的引用编号与引用清单重新对齐，保证列表里显示的 [n] 与答案正文一致，
 * 并让修复前已入库的历史回答也能展示一致的编号；同时把答案正文拆成可点击标记片段。
 *
 * Responsibilities:
 * - 按服务器引用顺序重编可见编号。
 * - 把越过清单范围的编号收敛到清单内，避免出现无对应来源的编号。
 * - 解析答案正文中的引用标记，供正文点击跳转到对应引用卡片。
 *
 * Notes:
 * - 纯展示逻辑；不改变服务器数据，也不裁剪引用清单。
 * - 服务端已保证编号一致，本函数对其结果是幂等的。
 */

/** 答案正文片段：普通文本或可跳转的引用标记。 */
export type AnswerSegment =
  { kind: 'text'; key: string; text: string } | { kind: 'citation'; key: string; number: number };

/**
 * 返回只重编了可见编号的引用副本。
 *
 * 答案正文标记按 1 基序号对应引用顺序，因此旧编号只需按引用顺序收敛为 1..N：
 * 既保留完整清单，也让正文中的每个 [n] 都能在列表里找到对应来源。
 */
export function alignCitationNumbers<T extends { number: number }>(citations: T[]): T[] {
  return citations.map((citation, index) => {
    const number = Math.min(Math.max(citation.number, 1), index + 1);
    return number === citation.number ? citation : { ...citation, number };
  });
}

/**
 * 把答案正文拆成文本片段与引用标记片段。
 *
 * 只有落在可见清单范围内的 [n] 才是可跳转标记；没有清单或编号越界时保持纯文本，
 * 避免出现过可点击但无处可跳的标记。
 */
export function splitAnswerCitations(answer: string, citationCount: number): AnswerSegment[] {
  if (citationCount < 1) return [{ kind: 'text', key: 'text-0', text: answer }];

  const segments: AnswerSegment[] = [];
  let cursor = 0;
  for (const match of answer.matchAll(/\[(\d+)\]/g)) {
    const start = match.index;
    const number = Number(match[1]);
    if (number < 1 || number > citationCount) continue;
    if (start > cursor)
      segments.push({ kind: 'text', key: `text-${cursor}`, text: answer.slice(cursor, start) });
    segments.push({ kind: 'citation', key: `citation-${start}`, number });
    cursor = start + match[0].length;
  }
  if (cursor < answer.length) {
    segments.push({ kind: 'text', key: `text-${cursor}`, text: answer.slice(cursor) });
  }
  return segments.length ? segments : [{ kind: 'text', key: 'text-0', text: answer }];
}
