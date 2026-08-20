/**
 * Tolerant JSON extraction from model output.
 *
 * DeepSeek thinking responses can wrap JSON in markdown fences, prefix or
 * append prose, or place the JSON in the reasoning stream instead of the
 * answer text. This module mirrors meta-pm-agent's utils/json.ts approach:
 * collect string-safe balanced JSON object candidates and return the first
 * one that parses, preferring the last complete object.
 */

import { AIMessage } from '@langchain/core/messages';

/**
 * Parses the first complete JSON object found in the given text, or null when
 * no valid object is present (for example when streaming output is truncated).
 */
export function parseJsonObject(text: string): unknown | null {
  for (const candidate of extractJsonObjectCandidates(text)) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Streamed output may mix in partial JSON; try the next candidate.
    }
  }
  return null;
}

/**
 * Extracts possible JSON object candidates, preferring the last complete one.
 */
function extractJsonObjectCandidates(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  if (withoutFence.startsWith('{')) {
    const rootEnd = findBalancedObjectEnd(withoutFence, 0);
    // If the root object never closes, the output is likely truncated; do not
    // fall back to parsing a nested object.
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
 * Finds the closing brace matching the brace at {@link start}, ignoring braces
 * inside strings and escapes. Returns -1 when the object never closes.
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

/**
 * Extracts the final AI answer text and any reasoning content from an agent
 * run's message list. Reasoning is returned separately so callers can attempt
 * structured JSON parsing from either stream (mirrors meta-pm-agent's
 * resolveJsonOutput text-then-reasoning order).
 */
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
