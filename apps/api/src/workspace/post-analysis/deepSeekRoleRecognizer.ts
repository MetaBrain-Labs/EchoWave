/**
 * DeepSeek 业务角色识别适配器。
 *
 * 根据完整转写、录音级说话人标识和数据源角色白名单，为每个说话人生成唯一业务角色。
 *
 * Responsibilities:
 * - 使用非思考 JSON Output 与有界网络重试。
 * - 校验说话人、角色白名单和证据片段归属。
 *
 * Notes:
 * - 模型不能生成白名单之外的角色；无法判断时必须返回“未知”。
 */
import { z } from 'zod';
import {
  CORE_BUSINESS_ROLES,
  type BusinessRoleKind,
  type SegmentRoleAnalysis,
} from '@echowave/contracts';

import {
  noOpAiExecutionRecorder,
  type AiExecutionRecorder,
} from '../../ai-observability/executionReporter.ts';
import type { PostAnalysisTranscriptSegment } from '../persistence/postAnalysisRepository.ts';
import { PostAnalysisProviderError } from './qwenEmotionAnalyzer.ts';
import { chatCompletionText, parseStructuredJson } from './structuredJson.ts';

const OutputSchema = z.object({
  speakers: z.array(
    z.object({
      speakerKey: z.string().min(1),
      role: z.string().trim().min(1).max(24),
      confidence: z.number().min(0).max(1),
      evidenceSegmentIds: z.array(z.string().uuid()).max(3),
    }),
  ),
});

function roleKind(label: string, customRoles: string[]): BusinessRoleKind {
  if (label === '销售') return 'sales';
  if (label === '客户') return 'customer';
  if (label === '其他') return 'other';
  if (label === '未知') return 'unknown';
  if (customRoles.includes(label)) return 'custom';
  return 'unknown';
}

/** 调用 DeepSeek 并返回与录音说话人一一对应的角色结果。 */
export class DeepSeekRoleRecognizer {
  constructor(
    private readonly options: {
      apiKey: string;
      baseUrl: string;
      model: string;
      fetch?: typeof fetch;
      sleep?: (durationMs: number) => Promise<void>;
    },
  ) {}

  async recognize(
    segments: PostAnalysisTranscriptSegment[],
    customRoles: string[],
    recorder: AiExecutionRecorder = noOpAiExecutionRecorder,
  ): Promise<(SegmentRoleAnalysis & { speakerKey: string })[]> {
    const allowedRoles = [...CORE_BUSINESS_ROLES, ...customRoles];
    const speakerSegments = new Map<string, Set<string>>();
    for (const segment of segments) {
      const ids = speakerSegments.get(segment.speakerKey) ?? new Set<string>();
      ids.add(segment.id);
      speakerSegments.set(segment.speakerKey, ids);
    }
    let previous = '';
    for (let structureAttempt = 1; structureAttempt <= 2; structureAttempt += 1) {
      const prompt = [
        'Classify the business role of every speaker in this Chinese call transcript.',
        `Allowed role labels: ${JSON.stringify(allowedRoles)}. Use 未知 when evidence is insufficient.`,
        'A speaker must have exactly one role for the whole recording.',
        'Return at most three evidence segment IDs, and only IDs spoken by that speaker.',
        'Return only JSON: {"speakers":[{"speakerKey":"Speaker 0","role":"客户","confidence":0.5,"evidenceSegmentIds":["uuid"]}]}',
        `Transcript: ${JSON.stringify(segments.map(({ id, speakerKey, startMs, endMs, text }) => ({ id, speakerKey, startMs, endMs, text })))}`,
        structureAttempt === 1
          ? ''
          : `The previous response was invalid. Correct it without adding roles or speakers: ${previous.slice(0, 12_000)}`,
      ].join('\n');
      const text = await this.request(prompt, structureAttempt, recorder);
      previous = text;
      const parsed = OutputSchema.safeParse(parseStructuredJson(text));
      if (!parsed.success) continue;
      const expectedSpeakers = new Set(speakerSegments.keys());
      const actualSpeakers = new Set(parsed.data.speakers.map(({ speakerKey }) => speakerKey));
      if (
        actualSpeakers.size !== parsed.data.speakers.length ||
        actualSpeakers.size !== expectedSpeakers.size
      )
        continue;
      const invalid = parsed.data.speakers.some((result) => {
        const evidence = speakerSegments.get(result.speakerKey);
        return (
          !expectedSpeakers.has(result.speakerKey) ||
          !allowedRoles.includes(result.role as (typeof allowedRoles)[number]) ||
          result.evidenceSegmentIds.some((id) => !evidence?.has(id))
        );
      });
      if (invalid) continue;
      return parsed.data.speakers.map((result) => ({
        speakerKey: result.speakerKey,
        kind: roleKind(result.role, customRoles),
        label: result.role,
        confidence: result.confidence,
        evidenceSegmentIds: result.evidenceSegmentIds,
        model: this.options.model,
      }));
    }
    throw new PostAnalysisProviderError(
      'INVALID_MODEL_OUTPUT',
      '角色识别模型未返回完整、可验证的说话人结果。',
      true,
    );
  }

  private async request(
    prompt: string,
    structureAttempt: number,
    recorder: AiExecutionRecorder,
  ): Promise<string> {
    const request = this.options.fetch ?? fetch;
    const sleep =
      this.options.sleep ??
      ((durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs)));
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const modelAttempt = (structureAttempt - 1) * 3 + attempt;
      const startedAt = Date.now();
      const messages = [{ role: 'user', content: prompt }];
      try {
        const response = await request(
          `${this.options.baseUrl.replace(/\/$/, '')}/chat/completions`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${this.options.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: this.options.model,
              temperature: 0,
              thinking: { type: 'disabled' },
              response_format: { type: 'json_object' },
              messages: [{ role: 'user', content: prompt }],
            }),
            signal: AbortSignal.timeout(60_000),
          },
        );
        if (!response.ok) {
          if (response.status < 500 && response.status !== 429) {
            throw new PostAnalysisProviderError(
              'MODEL_UNAVAILABLE',
              '角色识别模型当前不可用。',
              false,
            );
          }
          throw new Error(`provider-${response.status}`);
        }
        const content = chatCompletionText(await response.json());
        if (!content) throw new Error('empty-model-response');
        recorder.recordModelCall({
          name: 'audio-role-recognition',
          provider: 'deepseek',
          model: this.options.model,
          status: 'completed',
          attempt: modelAttempt,
          durationMs: Date.now() - startedAt,
          inputTokens: null,
          outputTokens: null,
          input: { kind: 'chat', messages },
          output: { role: 'assistant', content },
          metadata: { structureAttempt, networkAttempt: attempt },
        });
        return content;
      } catch (error) {
        recorder.recordModelCall({
          name: 'audio-role-recognition',
          provider: 'deepseek',
          model: this.options.model,
          status: 'failed',
          attempt: modelAttempt,
          durationMs: Date.now() - startedAt,
          inputTokens: null,
          outputTokens: null,
          input: { kind: 'chat', messages },
          output: { error },
          metadata: { structureAttempt, networkAttempt: attempt },
        });
        if (error instanceof PostAnalysisProviderError && !error.retryable) throw error;
        if (attempt === 3) {
          throw new PostAnalysisProviderError(
            'PROVIDER_ERROR',
            '角色识别服务暂时不可用，请稍后重试。',
            true,
          );
        }
        await sleep(250 * 2 ** (attempt - 1));
      }
    }
    throw new PostAnalysisProviderError('PROVIDER_ERROR', '角色识别服务暂时不可用。', true);
  }
}
