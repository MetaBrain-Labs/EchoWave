/**
 * 自动分析供应商错误分类。
 *
 * 只在错误文本明确表达余额、额度、凭据或缺失配置时产生硬阻塞；普通 429、网络异常和
 * 供应商 5xx 仍由既有阶段 Worker 的重试预算处理。
 *
 * Responsibilities:
 * - 将稳定错误码和安全错误文本映射为用户可恢复的阻塞原因。
 * - 避免仅凭 HTTP 429 将普通限流误判为余额耗尽。
 */
import type { AudioAnalysisBlockReason } from '@echowave/contracts';

import { SettingsError } from '../../../settings/types.ts';

export type HardBlockClassification = {
  reason: AudioAnalysisBlockReason;
  message: string;
};

const quotaPattern =
  /(?:insufficient|exhausted|余额不足|额度(?:不足|耗尽)|欠费|quota\s+(?:exceeded|exhausted)|billing)/i;
const credentialPattern =
  /(?:invalid[_ -]?(?:api[_ -]?key|credential)|unauthorized|forbidden|凭据(?:无效|失效)|密钥(?:无效|失效))/i;

/** 返回明确的硬阻塞；无法确认时保持普通阶段失败语义。 */
export function classifyHardBlock(error: unknown): HardBlockClassification | null {
  if (error instanceof SettingsError && error.code === 'CONFIGURATION_REQUIRED') {
    return { reason: 'CONFIGURATION_REQUIRED', message: error.message };
  }
  const record = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
  const code = typeof record.code === 'string' ? record.code : '';
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : typeof record.message === 'string'
          ? record.message
          : '';
  const combined = `${code} ${message}`.slice(0, 500);
  if (quotaPattern.test(combined)) {
    return { reason: 'API_QUOTA_EXCEEDED', message: message || '供应商明确返回额度不足。' };
  }
  if (credentialPattern.test(combined)) {
    return { reason: 'INVALID_CREDENTIALS', message: message || '供应商凭据无效。' };
  }
  if (code === 'CONFIGURATION_REQUIRED') {
    return { reason: 'CONFIGURATION_REQUIRED', message: message || '所需能力尚未配置。' };
  }
  return null;
}

/** 根据已持久化的阶段错误字段执行同一分类规则。 */
export function classifyStoredHardBlock(code: string | null, message: string | null) {
  return classifyHardBlock({ code: code ?? '', message: message ?? '' });
}
