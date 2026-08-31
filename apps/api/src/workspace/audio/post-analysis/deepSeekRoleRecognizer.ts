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
  beginAiModelCall,
  noOpAiExecutionRecorder,
  type AiExecutionRecorder,
} from '../../../ai-observability/executionReporter.ts';
import { runWithBoundedRetry } from '../../../ai-runtime/boundedRetry.ts';
import type { PostAnalysisTranscriptSegment } from './repository.ts';
import { PostAnalysisProviderError } from './qwenEmotionAnalyzer.ts';
import { roleRecognitionContext } from './role/CONTEXT.ts';
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
      const prompt = roleRecognitionContext(segments, allowedRoles, previous, structureAttempt);
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
    return runWithBoundedRetry({
      maxAttempts: 3,
      sleep,
      delayMs: (attempt) => 250 * 2 ** (attempt - 1),
      shouldRetry: (error) => !(error instanceof PostAnalysisProviderError && !error.retryable),
      onExhausted: () => {
        throw new PostAnalysisProviderError(
          'PROVIDER_ERROR',
          '角色识别服务暂时不可用，请稍后重试。',
          true,
        );
      },
      run: async (attempt) => {
        const modelAttempt = (structureAttempt - 1) * 3 + attempt;
        const startedAt = Date.now();
        const modelCall = beginAiModelCall(recorder, {
          name: 'audio-role-recognition',
          displayName: '根据完整对话识别说话人的业务角色',
          provider: 'deepseek',
          model: this.options.model,
          attempt: modelAttempt,
          reasoningMode: 'disabled',
        });
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
          modelCall.finish({
            status: 'completed',
            durationMs: Date.now() - startedAt,
            inputTokens: null,
            outputTokens: null,
            input: { kind: 'chat', messages },
            output: { role: 'assistant', content },
            metadata: { structureAttempt, networkAttempt: attempt },
          });
          return content;
        } catch (error) {
          modelCall.finish({
            status: 'failed',
            durationMs: Date.now() - startedAt,
            inputTokens: null,
            outputTokens: null,
            input: { kind: 'chat', messages },
            output: { error },
            metadata: { structureAttempt, networkAttempt: attempt },
          });
          throw error;
        }
      },
    });
  }
}
