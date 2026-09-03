/**
 * Qwen3.5-Omni 声学情绪分析适配器。
 *
 * 通过 DashScope OpenAI-compatible Chat Completions 发送短期 OSS 音频窗口，并将模型文本
 * 恢复为逐片段丰富情绪结果。
 *
 * Responsibilities:
 * - 执行有界网络重试和一次结构纠正。
 * - 验证目标片段 ID 完整且不包含越权结果。
 *
 * Notes:
 * - 不依赖供应商原生结构化输出；原始正文和响应不会写入错误或日志。
 */
import { z } from 'zod';
import { SegmentEmotionAnalysisSchema, type SegmentEmotionAnalysis } from '@echowave/contracts';

import {
  beginAiModelCall,
  noOpAiExecutionRecorder,
  type AiExecutionRecorder,
} from '../../../ai-observability/executionReporter.ts';
import { runWithBoundedRetry } from '../../../ai-runtime/boundedRetry.ts';
import type { PostAnalysisTranscriptSegment } from './repository.ts';
import { EMOTION_ANALYSIS_CONTEXT, emotionAnalysisInput } from './emotion/CONTEXT.ts';
import { chatCompletionText, parseStructuredJson } from './structuredJson.ts';

const OutputSchema = z.object({
  segments: z.array(
    SegmentEmotionAnalysisSchema.omit({ model: true }).extend({ segmentId: z.string().uuid() }),
  ),
});

export class PostAnalysisProviderError extends Error {
  constructor(
    public readonly code: 'MODEL_UNAVAILABLE' | 'PROVIDER_ERROR' | 'INVALID_MODEL_OUTPUT',
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'PostAnalysisProviderError';
  }
}

type WindowSegment = PostAnalysisTranscriptSegment & {
  relativeStartMs: number;
  relativeEndMs: number;
};

/** 调用 Qwen Omni 并返回与窗口目标一一对应的结果。 */
export class QwenEmotionAnalyzer {
  constructor(
    private readonly options: {
      apiKey: string;
      baseUrl: string;
      model: string;
      fetch?: typeof fetch;
      sleep?: (durationMs: number) => Promise<void>;
    },
  ) {}

  async analyze(
    audioUrl: string,
    segments: WindowSegment[],
    recorder: AiExecutionRecorder = noOpAiExecutionRecorder,
    reportContext: Record<string, unknown> = {},
  ): Promise<(SegmentEmotionAnalysis & { segmentId: string })[]> {
    let previous = '';
    for (let structureAttempt = 1; structureAttempt <= 2; structureAttempt += 1) {
      const prompt = emotionAnalysisInput(segments, previous, structureAttempt);
      const text = await this.request(audioUrl, prompt, structureAttempt, recorder, reportContext);
      previous = text;
      const parsed = OutputSchema.safeParse(parseStructuredJson(text));
      if (!parsed.success) continue;
      const expected = new Set(segments.map(({ id }) => id));
      const actual = new Set(parsed.data.segments.map(({ segmentId }) => segmentId));
      if (actual.size !== parsed.data.segments.length || actual.size !== expected.size) continue;
      if ([...actual].some((id) => !expected.has(id))) continue;
      return parsed.data.segments.map((result) => ({ ...result, model: this.options.model }));
    }
    throw new PostAnalysisProviderError(
      'INVALID_MODEL_OUTPUT',
      '情绪分析模型未返回完整、可验证的片段结果。',
      true,
    );
  }

  private async request(
    audioUrl: string,
    prompt: string,
    structureAttempt: number,
    recorder: AiExecutionRecorder,
    reportContext: Record<string, unknown>,
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
      onExhausted: (error) => {
        if (error instanceof PostAnalysisProviderError) throw error;
        throw new PostAnalysisProviderError(
          'PROVIDER_ERROR',
          '情绪分析服务暂时不可用，请稍后重试。',
          true,
        );
      },
      run: async (attempt) => {
        const modelAttempt = (structureAttempt - 1) * 3 + attempt;
        const startedAt = Date.now();
        const modelCall = beginAiModelCall(recorder, {
          name: 'audio-emotion-analysis',
          displayName: '判断当前音频片段的情绪与置信度',
          provider: 'dashscope',
          model: this.options.model,
          attempt: modelAttempt,
          reasoningMode: 'unsupported',
        });
        const messages = [
          { role: 'system', content: EMOTION_ANALYSIS_CONTEXT },
          {
            role: 'user',
            content: [
              { type: 'input_audio', input_audio: { data: '[OMITTED_AUDIO]', format: 'mp3' } },
              { type: 'text', text: prompt },
            ],
          },
        ];
        try {
          const response = await request(
            `${this.options.baseUrl.replace(/\/$/, '')}/chat/completions`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${this.options.apiKey}`,
                'Content-Type': 'application/json',
                ...(audioUrl.startsWith('oss://')
                  ? { 'X-DashScope-OssResourceResolve': 'enable' }
                  : {}),
              },
              body: JSON.stringify({
                model: this.options.model,
                modalities: ['text'],
                temperature: 0,
                messages: [
                  { role: 'system', content: EMOTION_ANALYSIS_CONTEXT },
                  {
                    role: 'user',
                    content: [
                      { type: 'input_audio', input_audio: { data: audioUrl, format: 'mp3' } },
                      { type: 'text', text: prompt },
                    ],
                  },
                ],
              }),
              signal: AbortSignal.timeout(120_000),
            },
          );
          if (!response.ok) {
            if (response.status < 500 && response.status !== 429) {
              throw new PostAnalysisProviderError(
                'MODEL_UNAVAILABLE',
                '情绪分析模型当前不可用。',
                false,
              );
            }
            throw new Error(`provider-${response.status}`);
          }
          const content = chatCompletionText(await response.json());
          if (!content) {
            throw new PostAnalysisProviderError(
              'INVALID_MODEL_OUTPUT',
              '情绪分析模型返回了无法识别的响应。',
              true,
            );
          }
          modelCall.finish({
            status: 'completed',
            durationMs: Date.now() - startedAt,
            inputTokens: null,
            outputTokens: null,
            input: { kind: 'chat', messages },
            output: { role: 'assistant', content },
            metadata: { ...reportContext, structureAttempt, networkAttempt: attempt },
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
            metadata: { ...reportContext, structureAttempt, networkAttempt: attempt },
          });
          throw error;
        }
      },
    });
  }
}
