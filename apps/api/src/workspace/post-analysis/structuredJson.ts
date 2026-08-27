/**
 * 后置分析结构化 JSON 恢复。
 *
 * 从模型文本中提取第一个完整对象，兼容 Markdown fence 与前后说明，同时拒绝截断对象。
 *
 * Responsibilities:
 * - 对字符串与转义安全地寻找平衡花括号。
 * - 仅恢复 JSON 语法，业务约束交给调用方 Zod schema。
 */

/** 从模型文本恢复一个完整 JSON 对象，失败时返回 null。 */
export function parseStructuredJson(text: string): unknown | null {
  const source = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '');
  let inString = false;
  let escaping = false;
  let depth = 0;
  let start = -1;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (escaping) {
      escaping = false;
      continue;
    }
    if (character === '\\' && inString) {
      escaping = true;
      continue;
    }
    if (character === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (character === '{') {
      if (depth === 0) start = index;
      depth += 1;
    } else if (character === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        try {
          return JSON.parse(source.slice(start, index + 1));
        } catch {
          start = -1;
        }
      }
    }
  }
  return null;
}

/** 从 OpenAI-compatible Chat Completion 响应提取最终文本。 */
export function chatCompletionText(value: unknown): string | null {
  if (
    !value ||
    typeof value !== 'object' ||
    !('choices' in value) ||
    !Array.isArray(value.choices)
  ) {
    return null;
  }
  const first = value.choices[0];
  if (!first || typeof first !== 'object' || !('message' in first)) return null;
  const message = first.message;
  if (!message || typeof message !== 'object' || !('content' in message)) return null;
  if (typeof message.content === 'string') return message.content;
  if (!Array.isArray(message.content)) return null;
  return (message.content as unknown[])
    .filter((item: unknown): item is { type: string; text: string } =>
      Boolean(item && typeof item === 'object' && 'text' in item && typeof item.text === 'string'),
    )
    .map((item: { text: string }) => item.text)
    .join('\n');
}
