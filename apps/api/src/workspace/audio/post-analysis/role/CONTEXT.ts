/**
 * 说话人业务角色识别模型上下文。
 *
 * 构造角色白名单、完整转写和结构修复指令，不包含模型调用或结果校验。
 *
 * Responsibilities:
 * - 为每次结构尝试构造完整角色识别输入。
 *
 * Notes:
 * - 一个说话人在整段录音中只能拥有一个角色。
 */
import type { SupportedLanguage } from '@echowave/contracts';

type RoleContextSegment = {
  id: string;
  speakerKey: string;
  startMs: number;
  endMs: number;
  text: string;
};

/** 构造角色识别与第二次结构修复共用的用户上下文。 */
export function roleRecognitionContext(
  segments: RoleContextSegment[],
  allowedRoles: string[],
  previous: string,
  structureAttempt: number,
  language: SupportedLanguage,
): string {
  const unknownRole = language === 'zh-CN' ? '未知' : 'Unknown';
  return [
    `Classify the business role of every speaker in this ${language === 'zh-CN' ? 'Chinese' : 'English'} call transcript.`,
    `Allowed role labels: ${JSON.stringify(allowedRoles)}. Use ${unknownRole} when evidence is insufficient.`,
    'A speaker must have exactly one role for the whole recording.',
    'Return at most three evidence segment IDs, and only IDs spoken by that speaker.',
    `Return only JSON: {"speakers":[{"speakerKey":"Speaker 0","role":"${language === 'zh-CN' ? '客户' : 'Customer'}","confidence":0.5,"evidenceSegmentIds":["uuid"]}]}`,
    `Transcript: ${JSON.stringify(segments.map(({ id, speakerKey, startMs, endMs, text }) => ({ id, speakerKey, startMs, endMs, text })))}`,
    structureAttempt === 1
      ? ''
      : `The previous response was invalid. Correct it without adding roles or speakers: ${previous.slice(0, 12_000)}`,
  ].join('\n');
}
