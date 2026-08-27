/**
 * DashScope 官方文本嵌入适配器。
 *
 * 通过 DashScope 原生 TextEmbedding 接口为 LangChain 提供查询与文档向量，并集中处理
 * 批次、用途参数、响应校验、有限重试和人民币成本估算。
 *
 * Responsibilities:
 * - 区分 query 与 document 向量语义并固定输出 1024 维稠密向量。
 * - 按官方上限拆分文档批次，并恢复供应商响应顺序。
 * - 返回 Token 用量、模型、供应商与带币种的估算成本。
 *
 * Notes:
 * - 不负责向量持久化或相似度检索。
 */
import { Embeddings } from '@langchain/core/embeddings';
import { z } from 'zod';

const QUERY_INSTRUCTION =
  'Given a user question, retrieve relevant passages from a Chinese knowledge base that answer the question';
const MAX_BATCH_SIZE = 20;
const EMBEDDING_PRICE_PER_MILLION_TOKENS_CNY = 0.5;

const EmbeddingResponseSchema = z.object({
  output: z.object({
    embeddings: z.array(
      z.object({ text_index: z.number().int().nonnegative(), embedding: z.array(z.number()) }),
    ),
  }),
  usage: z.object({ total_tokens: z.number().int().nonnegative() }),
});

/** 官方嵌入服务失败的稳定错误类型。 */
export class EmbeddingProviderError extends Error {
  constructor(
    public readonly code: 'MODEL_TIMEOUT' | 'MODEL_UNAVAILABLE',
    message: string,
    public readonly retryable = true,
  ) {
    super(message);
    this.name = 'EmbeddingProviderError';
  }
}

/** 单次或多批嵌入调用的向量、用量与成本汇总。 */
export type EmbeddingBatchResult = {
  vectors: number[][];
  tokens: number;
  provider: 'dashscope';
  model: string;
  estimatedCost: { amount: number; currency: 'CNY' };
};

type DashScopeEmbeddingsOptions = {
  apiKey: string;
  baseUrl: string;
  model: string;
  dimensions: number;
  fetchImplementation?: typeof fetch;
};

type EmbeddingTextType = 'query' | 'document';

/** 提供固定模型、维度、用途参数和运行时校验的 DashScope 嵌入适配器。 */
export class DashScopeEmbeddings extends Embeddings {
  private readonly fetchImplementation: typeof fetch;

  constructor(private readonly options: DashScopeEmbeddingsOptions) {
    super({ maxConcurrency: 2, maxRetries: 0 });
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  async embedDocuments(documents: string[]): Promise<number[][]> {
    return (await this.embedBatches(documents)).vectors;
  }

  async embedQuery(document: string): Promise<number[]> {
    const result = await this.embedBatch([document], 'query');
    const vector = result.vectors[0];
    if (!vector) throw new EmbeddingProviderError('MODEL_UNAVAILABLE', '嵌入服务返回了空结果。');
    return vector;
  }

  async embedQueryWithUsage(document: string, signal?: AbortSignal): Promise<EmbeddingBatchResult> {
    return this.embedBatch([document], 'query', signal);
  }

  async embedBatches(documents: string[]): Promise<EmbeddingBatchResult> {
    const vectors: number[][] = [];
    let tokens = 0;
    for (let start = 0; start < documents.length; start += MAX_BATCH_SIZE) {
      const result = await this.embedBatch(
        documents.slice(start, start + MAX_BATCH_SIZE),
        'document',
      );
      vectors.push(...result.vectors);
      tokens += result.tokens;
    }
    return this.result(vectors, tokens);
  }

  private result(vectors: number[][], tokens: number): EmbeddingBatchResult {
    return {
      vectors,
      tokens,
      provider: 'dashscope',
      model: this.options.model,
      estimatedCost: {
        amount: (tokens / 1_000_000) * EMBEDDING_PRICE_PER_MILLION_TOKENS_CNY,
        currency: 'CNY',
      },
    };
  }

  private async embedBatch(
    input: string[],
    textType: EmbeddingTextType,
    parentSignal?: AbortSignal,
  ): Promise<EmbeddingBatchResult> {
    if (input.length === 0 || input.length > MAX_BATCH_SIZE) {
      throw new Error(`Embedding batches must contain 1-${MAX_BATCH_SIZE} inputs.`);
    }
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (parentSignal?.aborted) {
        throw new EmbeddingProviderError('MODEL_TIMEOUT', '嵌入服务请求已取消。', false);
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      const signal = parentSignal
        ? AbortSignal.any([controller.signal, parentSignal])
        : controller.signal;
      try {
        const response = await this.fetchImplementation(
          `${this.options.baseUrl}/services/embeddings/text-embedding/text-embedding`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${this.options.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: this.options.model,
              input: { texts: input },
              parameters: {
                text_type: textType,
                dimension: this.options.dimensions,
                output_type: 'dense',
                ...(textType === 'query' ? { instruct: QUERY_INSTRUCTION } : {}),
              },
            }),
            signal,
          },
        );
        if (!response.ok) {
          const retryable = response.status === 429 || response.status >= 500;
          if (retryable && attempt < 3) {
            await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
            continue;
          }
          throw new EmbeddingProviderError(
            'MODEL_UNAVAILABLE',
            '嵌入服务当前不可用，请稍后重试。',
            retryable,
          );
        }
        const parsed = EmbeddingResponseSchema.safeParse(await response.json());
        if (!parsed.success) {
          throw new EmbeddingProviderError('MODEL_UNAVAILABLE', '嵌入服务返回了无效响应。', false);
        }
        const vectors = [...parsed.data.output.embeddings]
          .sort((left, right) => left.text_index - right.text_index)
          .map((item) => item.embedding);
        if (
          vectors.length !== input.length ||
          vectors.some((vector) => vector.length !== this.options.dimensions)
        ) {
          throw new EmbeddingProviderError(
            'MODEL_UNAVAILABLE',
            '嵌入向量数量或维度不正确。',
            false,
          );
        }
        return this.result(vectors, parsed.data.usage.total_tokens);
      } catch (error) {
        if (error instanceof EmbeddingProviderError) {
          if (error.retryable && attempt < 3) continue;
          throw error;
        }
        if (
          error instanceof Error &&
          (error.name === 'AbortError' || error.name === 'TimeoutError')
        ) {
          if (parentSignal?.aborted) {
            throw new EmbeddingProviderError('MODEL_TIMEOUT', '嵌入服务请求已取消。', false);
          }
          if (attempt < 3) continue;
          throw new EmbeddingProviderError('MODEL_TIMEOUT', '嵌入服务请求超时。');
        }
        if (attempt >= 3) {
          throw new EmbeddingProviderError('MODEL_UNAVAILABLE', '无法连接嵌入服务。');
        }
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new EmbeddingProviderError('MODEL_UNAVAILABLE', '嵌入服务当前不可用。');
  }
}
