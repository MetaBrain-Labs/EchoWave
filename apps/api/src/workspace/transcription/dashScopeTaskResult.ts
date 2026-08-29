/**
 * DashScope 异步任务终态入口。
 *
 * 将 Polling 与 EventBridge 发现的供应商终态收敛为同一持久化操作；耗时的结果下载、
 * 校验与发布仍由后台 worker 领取终态 revision 后完成。
 *
 * Responsibilities:
 * - 接收来源无关的 DashScope 终态对象。
 * - 依赖仓储保证未知任务、重复事件和冲突终态的幂等性。
 *
 * Notes:
 * - 本入口不得下载 transcription_url，保证 HTTP 回调可以快速返回。
 */
import {
  type AudioAnalysisRepository,
  type DashScopeProviderTerminal,
  type RecordedProviderTerminal,
} from '../persistence/audioAnalysisRepository.ts';

/** 持久化首个 DashScope 终态事实，供统一完成 worker 异步消费。 */
export async function handleDashScopeTaskResult(
  repository: AudioAnalysisRepository,
  terminal: DashScopeProviderTerminal,
): Promise<RecordedProviderTerminal | undefined> {
  return repository.recordProviderTerminal(terminal);
}
