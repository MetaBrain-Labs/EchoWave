/**
 * 跨领域模型结构化输出恢复。
 *
 * 容错提取完整 JSON 对象、LangChain AI 最终文本以及 OpenAI-compatible completion 文本。
 *
 * Responsibilities:
 * - 对字符串和转义安全地寻找平衡 JSON 对象。
 * - 拒绝截断根对象并优先尝试最后一个完整候选。
 * - 统一提取模型文本，不执行领域 schema 校验。
 *
 * Notes:
 * - 业务合法性始终由调用方的 Zod schema 判断。
 */
import { AIMessage } from '@langchain/core/messages';

/** 从任意模型文本中解析最后一个完整 JSON 对象；失败返回 null。 */
export function parseJsonObject(text: string): unknown | null {
  for (const candidate of extractJsonObjectCandidates(text)) {
    try {
      return JSON.parse(candidate);
    } catch {
      // 继续尝试下一个完整候选，领域校验由调用方完成。
    }
  }
  return null;
}

/** 兼容后置分析调用方的结构化 JSON 命名。 */
export const parseStructuredJson = parseJsonObject;

function extractJsonObjectCandidates(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  if (withoutFence.startsWith('{')) {
    const rootEnd = findBalancedObjectEnd(withoutFence, 0);
    return rootEnd === -1 ? [] : [withoutFence.slice(0, rootEnd + 1)];
  }

  const candidates: string[] = [];
  let inString = false;
  let escaping = false;
  for (let index = 0; index < withoutFence.length; index += 1) {
    const char = withoutFence[index];
    if (escaping) {
      escaping = false;
      continue;
    }
    if (char === '\\') {
      escaping = inString;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString || char !== '{') continue;
    const end = findBalancedObjectEnd(withoutFence, index);
    if (end === -1) break;
    candidates.push(withoutFence.slice(index, end + 1));
    index = end;
  }
  return candidates.reverse();
}

function findBalancedObjectEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaping = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (escaping) {
      escaping = false;
      continue;
    }
    if (char === '\\') {
      escaping = inString;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '{') {
      depth += 1;
      continue;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/** 提取 Agent 最终文本与 reasoning 内容。 */
export function extractFinalMessageText(messages: unknown[]): { text: string; reasoning: string } {
  let text = '';
  let reasoning = '';
  for (const message of messages) {
    if (!(message instanceof AIMessage)) continue;
    if (typeof message.content === 'string') {
      text = message.content;
    } else if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if (
          typeof block === 'object' &&
          block !== null &&
          'type' in block &&
          block.type === 'text' &&
          'text' in block &&
          typeof block.text === 'string'
        ) {
          text = block.text;
        }
      }
    }
    const reasoningContent = message.additional_kwargs?.reasoning_content;
    if (typeof reasoningContent === 'string' && reasoningContent) reasoning = reasoningContent;
  }
  return { text, reasoning };
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
    .map((item) => item.text)
    .join('\n');
}
