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
import {
  AudioEmotionArousalSchema,
  AudioEmotionAttitudeSchema,
  AudioEmotionLabelSchema,
  AudioEmotionPaceSchema,
  AudioEmotionPausePatternSchema,
  AudioEmotionPitchVariationSchema,
  AudioEmotionVolumeTrendSchema,
  SegmentEmotionAnalysisSchema,
  type SegmentEmotionAnalysis,
} from '@echowave/contracts';

import {
  noOpAiExecutionRecorder,
  type AiExecutionRecorder,
} from '../../ai-observability/executionReporter.ts';
import type { PostAnalysisTranscriptSegment } from '../persistence/postAnalysisRepository.ts';
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

const SYSTEM_PROMPT = [
  'You analyze acoustic emotion in Chinese business-call audio.',
  'Judge how each target segment is spoken, using the audio, timestamps, and transcript only.',
  'Return one result for every target segment ID and no other IDs.',
  `emotion labels: ${AudioEmotionLabelSchema.options.join(', ')}`,
  `attitude labels: ${AudioEmotionAttitudeSchema.options.join(', ')}`,
  `arousal labels: ${AudioEmotionArousalSchema.options.join(', ')}`,
  `pace labels: ${AudioEmotionPaceSchema.options.join(', ')}`,
  `volumeTrend labels: ${AudioEmotionVolumeTrendSchema.options.join(', ')}`,
  `pitchVariation labels: ${AudioEmotionPitchVariationSchema.options.join(', ')}`,
  `pausePattern labels: ${AudioEmotionPausePatternSchema.options.join(', ')}`,
  'confidence must be between 0 and 1. vocalCues must contain at most five concise Chinese observations.',
  'Return only one JSON object with shape {"segments":[{"segmentId":"uuid","label":"neutral","confidence":0.5,"attitude":"neutral","arousal":"medium","pace":"normal","volumeTrend":"normal","pitchVariation":"medium","pausePattern":"normal","vocalCues":[]}]}',
].join('\n');

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
      const prompt = [
        'Target segments, with times relative to the attached audio window:',
        JSON.stringify(
          segments.map(({ id, speakerKey, relativeStartMs, relativeEndMs, text }) => ({
            segmentId: id,
            speakerKey,
            startMs: relativeStartMs,
            endMs: relativeEndMs,
            text,
          })),
        ),
        structureAttempt === 1
          ? 'Analyze every target now.'
          : `The previous response was invalid. Return corrected JSON only. Previous response: ${previous.slice(0, 12_000)}`,
      ].join('\n');
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
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const modelAttempt = (structureAttempt - 1) * 3 + attempt;
      const startedAt = Date.now();
      const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
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
            },
            body: JSON.stringify({
              model: this.options.model,
              modalities: ['text'],
              temperature: 0,
              messages: [
                { role: 'system', content: SYSTEM_PROMPT },
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
        recorder.recordModelCall({
          name: 'audio-emotion-analysis',
          provider: 'dashscope',
          model: this.options.model,
          status: 'completed',
          attempt: modelAttempt,
          durationMs: Date.now() - startedAt,
          inputTokens: null,
          outputTokens: null,
          input: { kind: 'chat', messages },
          output: { role: 'assistant', content },
          metadata: { ...reportContext, structureAttempt, networkAttempt: attempt },
        });
        return content;
      } catch (error) {
        recorder.recordModelCall({
          name: 'audio-emotion-analysis',
          provider: 'dashscope',
          model: this.options.model,
          status: 'failed',
          attempt: modelAttempt,
          durationMs: Date.now() - startedAt,
          inputTokens: null,
          outputTokens: null,
          input: { kind: 'chat', messages },
          output: { error },
          metadata: { ...reportContext, structureAttempt, networkAttempt: attempt },
        });
        if (error instanceof PostAnalysisProviderError && !error.retryable) throw error;
        if (attempt === 3) {
          if (error instanceof PostAnalysisProviderError) throw error;
          throw new PostAnalysisProviderError(
            'PROVIDER_ERROR',
            '情绪分析服务暂时不可用，请稍后重试。',
            true,
          );
        }
        await sleep(250 * 2 ** (attempt - 1));
      }
    }
    throw new PostAnalysisProviderError('PROVIDER_ERROR', '情绪分析服务暂时不可用。', true);
  }
}
