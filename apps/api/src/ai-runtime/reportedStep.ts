/**
 * AI 工作流步骤审计包装器。
 *
 * 为异步工作流步骤统一记录开始、完成、失败、耗时和可选摘要。
 *
 * Responsibilities:
 * - 保证成功与失败路径成对记录。
 * - 允许调用方按领域结果生成安全元数据。
 *
 * Notes:
 * - 不吞掉异常，也不改变步骤的返回值或重试策略。
 */
import type { AiExecutionRecorder } from '../ai-observability/executionReporter.ts';

/** 执行一个带审计生命周期的异步步骤。 */
export async function runReportedStep<T>(
  report: AiExecutionRecorder,
  name: string,
  operation: () => Promise<T>,
  summarize?: (result: T) => Record<string, unknown>,
): Promise<T> {
  const startedAt = Date.now();
  report.recordStep({ name, status: 'started' });
  try {
    const result = await operation();
    report.recordStep({
      name,
      status: 'completed',
      durationMs: Date.now() - startedAt,
      ...(summarize ? { metadata: summarize(result) } : {}),
    });
    return result;
  } catch (error) {
    report.recordStep({ name, status: 'failed', durationMs: Date.now() - startedAt });
    throw error;
  }
}
