/** LangChain Embeddings adapter with OpenRouter-specific routing, usage, validation, and retries. */
import { Embeddings } from '@langchain/core/embeddings';
import { z } from 'zod';

const QUERY_INSTRUCTION =
  'Given a user question, retrieve relevant passages from a Chinese knowledge base that answer the question';
const MAX_BATCH_SIZE = 64;
const EMBEDDING_PRICE_PER_MILLION_TOKENS_USD = 0.01;

const EmbeddingResponseSchema = z.object({
  data: z.array(z.object({ index: z.number().int().nonnegative(), embedding: z.array(z.number()) })),
  model: z.string().optional(),
  provider: z.string().optional(),
  usage: z.object({ prompt_tokens: z.number().int().nonnegative().optional(), total_tokens: z.number().int().nonnegative().optional() }).optional(),
});

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

export type EmbeddingBatchResult = {
  vectors: number[][];
  tokens: number;
  provider: string;
  model: string;
  estimatedCostUsd: number;
};

type OpenRouterEmbeddingsOptions = {
  apiKey: string;
  model: string;
  dimensions: number;
  fetchImplementation?: typeof fetch;
};

export class OpenRouterEmbeddings extends Embeddings {
  private readonly fetchImplementation: typeof fetch;

  constructor(private readonly options: OpenRouterEmbeddingsOptions) {
    super({ maxConcurrency: 2, maxRetries: 0 });
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  async embedDocuments(documents: string[]): Promise<number[][]> {
    return (await this.embedBatches(documents)).vectors;
  }

  async embedQuery(document: string): Promise<number[]> {
    const input = `${QUERY_INSTRUCTION}\n\nQuestion: ${document}`;
    const result = await this.embedBatch([input]);
    const vector = result.vectors[0];
    if (!vector) throw new EmbeddingProviderError('MODEL_UNAVAILABLE', '嵌入服务返回了空结果。');
    return vector;
  }

  async embedQueryWithUsage(document: string): Promise<EmbeddingBatchResult> {
    return this.embedBatch([`${QUERY_INSTRUCTION}\n\nQuestion: ${document}`]);
  }

  async embedBatches(documents: string[]): Promise<EmbeddingBatchResult> {
    const vectors: number[][] = [];
    let tokens = 0;
    let provider = 'unknown';
    let model = this.options.model;
    for (let start = 0; start < documents.length; start += MAX_BATCH_SIZE) {
      const result = await this.embedBatch(documents.slice(start, start + MAX_BATCH_SIZE));
      vectors.push(...result.vectors);
      tokens += result.tokens;
      provider = result.provider;
      model = result.model;
    }
    return {
      vectors,
      tokens,
      provider,
      model,
      estimatedCostUsd: (tokens / 1_000_000) * EMBEDDING_PRICE_PER_MILLION_TOKENS_USD,
    };
  }

  private async embedBatch(input: string[]): Promise<EmbeddingBatchResult> {
    if (input.length === 0 || input.length > MAX_BATCH_SIZE) {
      throw new Error(`Embedding batches must contain 1-${MAX_BATCH_SIZE} inputs.`);
    }
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      try {
        const response = await this.fetchImplementation('https://openrouter.ai/api/v1/embeddings', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.options.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://echowave.local',
            'X-Title': 'EchoWave',
          },
          body: JSON.stringify({
            model: this.options.model,
            input,
            dimensions: this.options.dimensions,
            encoding_format: 'float',
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          if ((response.status === 429 || response.status >= 500) && attempt < 3) {
            await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
            continue;
          }
          throw new EmbeddingProviderError('MODEL_UNAVAILABLE', '嵌入服务当前不可用，请稍后重试。');
        }
        const parsed = EmbeddingResponseSchema.safeParse(await response.json());
        if (!parsed.success) {
          throw new EmbeddingProviderError('MODEL_UNAVAILABLE', '嵌入服务返回了无效响应。');
        }
        const vectors = [...parsed.data.data]
          .sort((left, right) => left.index - right.index)
          .map((item) => item.embedding);
        if (vectors.length !== input.length || vectors.some((vector) => vector.length !== this.options.dimensions)) {
          throw new EmbeddingProviderError('MODEL_UNAVAILABLE', '嵌入向量数量或维度不正确。');
        }
        const tokens = parsed.data.usage?.total_tokens ?? parsed.data.usage?.prompt_tokens ?? 0;
        return {
          vectors,
          tokens,
          provider: parsed.data.provider ?? response.headers.get('x-openrouter-provider') ?? 'unknown',
          model: parsed.data.model ?? this.options.model,
          estimatedCostUsd: (tokens / 1_000_000) * EMBEDDING_PRICE_PER_MILLION_TOKENS_USD,
        };
      } catch (error) {
        if (error instanceof EmbeddingProviderError) {
          if (error.retryable && attempt < 3) continue;
          throw error;
        }
        if (error instanceof Error && error.name === 'AbortError') {
          if (attempt < 3) continue;
          throw new EmbeddingProviderError('MODEL_TIMEOUT', '嵌入服务请求超时。');
        }
        if (attempt >= 3) throw new EmbeddingProviderError('MODEL_UNAVAILABLE', '无法连接嵌入服务。');
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new EmbeddingProviderError('MODEL_UNAVAILABLE', '嵌入服务当前不可用。');
  }
}
