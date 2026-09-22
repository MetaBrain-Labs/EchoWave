/**
 * DashScope Qwen 文本重排适配器。
 *
 * 调用百炼 Workspace 原生文本重排接口，并将供应商输出恢复为可稳定排序的候选分数。
 *
 * Responsibilities:
 * - 固定 Qwen3.7 模型、检索 instruct、八秒总预算和一次有限重试。
 * - 严格校验索引覆盖、唯一性、分数范围与 token 用量。
 *
 * Notes:
 * - 错误只暴露稳定代码，不携带 Credential、候选正文或供应商响应体。
 */
import { z } from 'zod';

import { KNOWLEDGE_RERANK_MODEL } from './settingsService.ts';

const RERANK_INSTRUCTION =
  'Given a web search query, retrieve relevant passages that answer the query.';
const RERANK_TIMEOUT_MS = 8_000;

const RerankResponseSchema = z.object({
  output: z.object({
    results: z.array(
      z.object({
        index: z.number().int().nonnegative(),
        relevance_score: z.number().finite().min(0).max(1),
      }),
    ),
  }),
  usage: z.object({ total_tokens: z.number().int().nonnegative() }),
});

export type RerankResult = {
  scores: number[];
  tokens: number;
  durationMs: number;
  attempts: number;
};

/** 重排供应商失败的安全分类。 */
export class RerankProviderError extends Error {
  constructor(
    public readonly code:
      | 'NOT_CONFIGURED'
      | 'MODEL_TIMEOUT'
      | 'RATE_LIMITED'
      | 'MODEL_UNAVAILABLE'
      | 'INVALID_RESPONSE',
    message: string,
  ) {
    super(message);
    this.name = 'RerankProviderError';
  }
}

type DashScopeRerankerOptions = {
  apiKey: string;
  baseUrl: string;
  fetchImplementation?: typeof fetch;
  now?: () => number;
};

/** 调用固定 Qwen3.7 文本重排模型。 */
export class DashScopeReranker {
  private readonly fetchImplementation: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly options: DashScopeRerankerOptions) {
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.now = options.now ?? Date.now;
  }

  /** 返回与输入 documents 一一对应的相关性分数。 */
  async rerank(query: string, documents: string[], parentSignal?: AbortSignal): Promise<RerankResult> {
    if (!this.options.apiKey || !this.options.baseUrl) {
      throw new RerankProviderError('NOT_CONFIGURED', '重排模型尚未完整配置。');
    }
    if (!documents.length || documents.length > 20) {
      throw new Error('Rerank requests must contain 1-20 documents.');
    }
    const startedAt = this.now();
    const deadline = startedAt + RERANK_TIMEOUT_MS;
    let lastCode: RerankProviderError['code'] = 'MODEL_UNAVAILABLE';
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      if (parentSignal?.aborted || this.now() >= deadline) {
        throw new RerankProviderError('MODEL_TIMEOUT', '重排请求已取消或超时。');
      }
      const controller = new AbortController();
      const remaining = Math.max(1, deadline - this.now());
      const timeout = setTimeout(() => controller.abort(), remaining);
      const signal = parentSignal
        ? AbortSignal.any([parentSignal, controller.signal])
        : controller.signal;
      try {
        const response = await this.fetchImplementation(
          `${this.options.baseUrl}/services/rerank/text-rerank/text-rerank`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${this.options.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: KNOWLEDGE_RERANK_MODEL,
              input: { query, documents },
              parameters: {
                instruct: RERANK_INSTRUCTION,
                top_n: documents.length,
              },
            }),
            signal,
          },
        );
        if (!response.ok) {
          const retryable = response.status === 429 || response.status >= 500;
          lastCode = response.status === 429 ? 'RATE_LIMITED' : 'MODEL_UNAVAILABLE';
          if (retryable && attempt === 1 && this.now() + 150 < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 150));
            continue;
          }
          throw new RerankProviderError(lastCode, '重排服务当前不可用。');
        }
        let responseBody: unknown;
        try {
          responseBody = await response.json();
        } catch {
          throw new RerankProviderError('INVALID_RESPONSE', '重排服务返回了无效响应。');
        }
        const parsed = RerankResponseSchema.safeParse(responseBody);
        if (!parsed.success || parsed.data.output.results.length !== documents.length) {
          throw new RerankProviderError('INVALID_RESPONSE', '重排服务返回了无效响应。');
        }
        const scores = new Array<number>(documents.length);
        const seen = new Set<number>();
        for (const item of parsed.data.output.results) {
          if (item.index >= documents.length || seen.has(item.index)) {
            throw new RerankProviderError('INVALID_RESPONSE', '重排服务返回了无效索引。');
          }
          seen.add(item.index);
          scores[item.index] = item.relevance_score;
        }
        if (seen.size !== documents.length) {
          throw new RerankProviderError('INVALID_RESPONSE', '重排服务未覆盖全部候选。');
        }
        return {
          scores,
          tokens: parsed.data.usage.total_tokens,
          durationMs: this.now() - startedAt,
          attempts: attempt,
        };
      } catch (error) {
        if (error instanceof RerankProviderError) throw error;
        if (
          parentSignal?.aborted ||
          controller.signal.aborted ||
          (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'))
        ) {
          throw new RerankProviderError('MODEL_TIMEOUT', '重排请求已取消或超时。');
        }
        throw new RerankProviderError('MODEL_UNAVAILABLE', '无法连接重排服务。');
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new RerankProviderError(lastCode, '重排服务当前不可用。');
  }
}
