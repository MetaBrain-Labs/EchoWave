/**
 * 有界重试执行器。
 *
 * 为模型适配器复用尝试次数、退避和终态映射，同时把策略参数留给调用方。
 *
 * Responsibilities:
 * - 串行执行有限次数的异步尝试。
 * - 按调用方分类决定是否重试并映射最终错误。
 *
 * Notes:
 * - 本模块不判断 Provider 状态，也不改变超时、错误文案或报告行为。
 */
export type BoundedRetryOptions<T> = {
  maxAttempts: number;
  run: (attempt: number) => Promise<T>;
  shouldRetry: (error: unknown, attempt: number) => boolean;
  delayMs: (attempt: number) => number;
  sleep: (durationMs: number) => Promise<void>;
  onExhausted: (error: unknown) => never;
};

/** 按显式策略执行有界异步重试。 */
export async function runWithBoundedRetry<T>(options: BoundedRetryOptions<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      return await options.run(attempt);
    } catch (error) {
      lastError = error;
      if (!options.shouldRetry(error, attempt)) throw error;
      if (attempt < options.maxAttempts) await options.sleep(options.delayMs(attempt));
    }
  }
  return options.onExhausted(lastError);
}
