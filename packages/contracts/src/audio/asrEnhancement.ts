/**
 * ASR 识别增强网络契约。
 *
 * 约束 Qwen 文件转写使用的上下文文本和热词，并统一 API、自动任务与移动端的字段。
 *
 * Responsibilities:
 * - 校验服务端默认上下文、本次任务覆盖值和数据源词表。
 * - 保持增强配置可安全冻结到可恢复的音频任务快照。
 *
 * Notes:
 * - 该契约只影响 ASR，不作为业务分析模型的事实证据。
 */
import { z } from 'zod';

const MAX_CONTEXT_CHARACTERS = 400;
const MAX_HOTWORDS = 2_000;

function countCharacters(value: string): number {
  return Array.from(value).length;
}

const HotwordSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .superRefine((value, context) => {
    const asciiOnly = /^[\x00-\x7F]+$/u.test(value);
    const length = asciiOnly ? value.split(/\s+/u).length : countCharacters(value);
    const limit = asciiOnly ? 7 : 15;
    if (length > limit) {
      context.addIssue({
        code: 'too_big',
        maximum: limit,
        origin: 'array',
        inclusive: true,
        message: asciiOnly
          ? '纯 ASCII 热词最多包含 7 个空格分隔片段。'
          : '包含非 ASCII 字符的热词最多包含 15 个字符。',
      });
    }
  });

export const AsrHotwordsSchema = z
  .array(HotwordSchema)
  .max(MAX_HOTWORDS)
  .transform((items) => [...new Set(items.map((item) => item.trim()))]);

export const AsrContextTextSchema = z
  .string()
  .trim()
  .refine((value) => countCharacters(value) <= MAX_CONTEXT_CHARACTERS, {
    message: `ASR 上下文最多 ${MAX_CONTEXT_CHARACTERS} 个字符。`,
  });

/** 一次 ASR 任务的可选增强覆盖；空字符串明确表示本次不使用上下文。 */
export const AsrEnhancementSchema = z
  .object({
    contextText: AsrContextTextSchema.optional(),
    additionalHotwords: AsrHotwordsSchema.default([]),
  })
  .strict();

/** 已合并并冻结的 ASR 增强配置，随任务版本保存。 */
export const AsrEnhancementSnapshotSchema = z
  .object({
    contextText: AsrContextTextSchema,
    hotwords: AsrHotwordsSchema,
    defaultContextRevision: z.number().int().nonnegative(),
  })
  .strict();

/** 租户默认上下文的读写请求。 */
export const AsrPreferenceSchema = z
  .object({
    defaultContext: AsrContextTextSchema,
    revision: z.number().int().nonnegative(),
  })
  .strict();

export const AsrPreferenceUpdateRequestSchema = z
  .object({
    defaultContext: AsrContextTextSchema,
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();

export type AsrEnhancement = z.infer<typeof AsrEnhancementSchema>;
export type AsrEnhancementSnapshot = z.infer<typeof AsrEnhancementSnapshotSchema>;
export type AsrPreference = z.infer<typeof AsrPreferenceSchema>;
export type AsrPreferenceUpdateRequest = z.infer<typeof AsrPreferenceUpdateRequestSchema>;

export const ASR_MAX_CONTEXT_CHARACTERS = MAX_CONTEXT_CHARACTERS;
export const ASR_MAX_HOTWORDS = MAX_HOTWORDS;
