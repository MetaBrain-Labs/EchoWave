/**
 * DeepSeek 说话人疑点复核适配器。
 *
 * 使用词索引化转写寻找需要人工回听的边界，并严格拒绝模型虚构的片段与索引。
 *
 * Responsibilities:
 * - 执行有界网络重试和 JSON 结构校验。
 * - 将模型输出限制在真实词边界内。
 */
import { z } from 'zod';

import {
  beginAiModelCall,
  noOpAiExecutionRecorder,
  type AiExecutionRecorder,
} from '../../../ai-observability/executionReporter.ts';
import { runWithBoundedRetry } from '../../../ai-runtime/boundedRetry.ts';
import { PostAnalysisProviderError } from '../post-analysis/qwenEmotionAnalyzer.ts';
import { chatCompletionText, parseStructuredJson } from '../post-analysis/structuredJson.ts';
import { speakerReviewContext } from './CONTEXT.ts';
import type { ModelSpeakerReviewFinding, SpeakerReviewSegment } from './repository.ts';

const OutputSchema = z
  .object({
    findings: z.array(
      z
        .object({
          segmentId: z.string().uuid(),
          splitAfterWordIndex: z.number().int().nonnegative(),
          severity: z.enum(['medium', 'high']),
          reasonCode: z.enum([
            'question_answer_transition',
            'long_internal_pause',
            'dialogue_pattern',
          ]),
          explanation: z.string().trim().min(1).max(200),
        })
        .strict(),
    ),
  })
  .strict();

/** 调用文本模型生成仅供人工复核的说话人边界疑点。 */
export class DeepSeekSpeakerReviewer {
  constructor(
    private readonly options: {
      apiKey: string;
      baseUrl: string;
      model: string;
      fetch?: typeof fetch;
      sleep?: (durationMs: number) => Promise<void>;
    },
  ) {}

  async review(
    segments: SpeakerReviewSegment[],
    recorder: AiExecutionRecorder = noOpAiExecutionRecorder,
  ): Promise<ModelSpeakerReviewFinding[]> {
    const eligible = segments.filter(
      (segment) => segment.words.length > 1 && segment.candidateBoundaries.length > 0,
    );
    if (eligible.length === 0) return [];
    const prompt = speakerReviewContext(
      eligible.flatMap((segment) =>
        segment.candidateBoundaries.map((boundary) => ({
          segmentId: segment.id,
          speakerKey: segment.speakerKey,
          splitAfterWordIndex: boundary,
          leftContext: segment.words
            .slice(Math.max(0, boundary - 5), boundary + 1)
            .map(({ index, text, punctuation }) => ({ index, text, punctuation })),
          rightContext: segment.words
            .slice(boundary + 1, boundary + 7)
            .map(({ index, text, punctuation }) => ({ index, text, punctuation })),
        })),
      ),
    );
    const content = await this.request(prompt, recorder);
    const parsed = OutputSchema.safeParse(parseStructuredJson(content));
    if (!parsed.success) {
      throw new PostAnalysisProviderError(
        'INVALID_MODEL_OUTPUT',
        '说话人复核模型未返回有效结构。',
        true,
      );
    }
    const byId = new Map(eligible.map((segment) => [segment.id, segment]));
    const unique = new Map<string, ModelSpeakerReviewFinding>();
    for (const finding of parsed.data.findings) {
      const segment = byId.get(finding.segmentId);
      if (!segment || !segment.candidateBoundaries.includes(finding.splitAfterWordIndex)) {
        throw new PostAnalysisProviderError(
          'INVALID_MODEL_OUTPUT',
          '说话人复核模型引用了不存在的片段或词边界。',
          true,
        );
      }
      unique.set(`${finding.segmentId}:${finding.splitAfterWordIndex}`, finding);
    }
    return [...unique.values()];
  }

  private async request(prompt: string, recorder: AiExecutionRecorder): Promise<string> {
    const request = this.options.fetch ?? fetch;
    const sleep =
      this.options.sleep ??
      ((durationMs: number) => new Promise((resolve) => setTimeout(resolve, durationMs)));
    return runWithBoundedRetry({
      maxAttempts: 3,
      sleep,
      delayMs: (attempt) => 250 * 2 ** (attempt - 1),
      shouldRetry: (error) => !(error instanceof PostAnalysisProviderError && !error.retryable),
      onExhausted: () => {
        throw new PostAnalysisProviderError('PROVIDER_ERROR', '说话人智能复核暂时不可用。', true);
      },
      run: async (attempt) => {
        const startedAt = Date.now();
        const modelCall = beginAiModelCall(recorder, {
          name: 'audio-speaker-review',
          displayName: '复核疑似说话人切换边界',
          provider: 'deepseek',
          model: this.options.model,
          attempt,
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
                messages,
              }),
              signal: AbortSignal.timeout(60_000),
            },
          );
          if (!response.ok) {
            if (response.status < 500 && response.status !== 429) {
              throw new PostAnalysisProviderError(
                'MODEL_UNAVAILABLE',
                '说话人复核模型当前不可用。',
                false,
              );
            }
            throw new Error(`provider-${response.status}`);
          }
          const output = chatCompletionText(await response.json());
          if (!output) throw new Error('empty-model-response');
          modelCall.finish({
            status: 'completed',
            durationMs: Date.now() - startedAt,
            inputTokens: null,
            outputTokens: null,
            input: { kind: 'chat', messages },
            output: { role: 'assistant', content: output },
          });
          return output;
        } catch (error) {
          modelCall.finish({
            status: 'failed',
            durationMs: Date.now() - startedAt,
            inputTokens: null,
            outputTokens: null,
            input: { kind: 'chat', messages },
            output: { error },
          });
          throw error;
        }
      },
    });
  }
}
