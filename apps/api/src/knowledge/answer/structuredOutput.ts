/**
 * 模型结构化输出恢复工具。
 *
 * 从 DeepSeek 的文本或 reasoning 内容中容错提取完整 JSON 对象，兼容 Markdown fence、
 * 前后说明文字与字符串内转义，同时拒绝截断对象。
 *
 * Responsibilities:
 * - 查找字符串安全的平衡 JSON 对象候选。
 * - 提取最终 AI 文本与 reasoning 内容。
 *
 * Notes:
 * - 这里只恢复语法结构，业务 schema 校验由调用模块完成。
 */

import { AIMessage } from '@langchain/core/messages';

/** 从任意模型文本中解析最后一个完整 JSON 对象；截断或无效内容返回 null。 */
export function parseJsonObject(text: string): unknown | null {
  for (const candidate of extractJsonObjectCandidates(text)) {
    try {
      return JSON.parse(candidate);
    } catch {
      // 模型输出可能混入残缺 JSON；继续尝试下一个完整候选。
    }
  }
  return null;
}

/** 提取所有完整 JSON 对象候选，并优先尝试模型输出中最后出现的对象。 */
function extractJsonObjectCandidates(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  if (withoutFence.startsWith('{')) {
    const rootEnd = findBalancedObjectEnd(withoutFence, 0);
    // 根对象未闭合表示输出可能被截断，此时不能退回解析内部嵌套对象。
    if (rootEnd === -1) return [];
    return [withoutFence.slice(0, rootEnd + 1)];
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
    if (inString) continue;

    if (char !== '{') continue;

    const end = findBalancedObjectEnd(withoutFence, index);
    if (end === -1) break;
    candidates.push(withoutFence.slice(index, end + 1));
    index = end;
  }

  return candidates.reverse();
}

/**
 * 查找与 {@link start} 处左花括号匹配的右花括号，忽略字符串与转义序列中的括号。
 * 对象未闭合时返回 -1，避免把截断输出误判为有效 JSON。
 */
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
    if (char !== '}') continue;

    depth -= 1;
    if (depth === 0) return index;
  }

  return -1;
}

/** 提取 Agent 最终文本与 reasoning 内容，供调用方按固定优先级恢复结构化结果。 */
export function extractFinalMessageText(messages: unknown[]): {
  text: string;
  reasoning: string;
} {
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
    if (typeof reasoningContent === 'string' && reasoningContent) {
      reasoning = reasoningContent;
    }
  }

  return { text, reasoning };
}
