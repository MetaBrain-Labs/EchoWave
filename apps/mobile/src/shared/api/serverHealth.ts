/**
 * EchoWave Server 连接探测。
 *
 * 对候选服务器执行有界健康请求，并在客户端信任边界校验服务身份和 API 版本。
 *
 * Responsibilities:
 * - 请求公开 GET /health 端点。
 * - 将超时、网络、HTTP 和契约错误映射为稳定类别。
 *
 * Notes:
 * - 探测成功不代表业务供应商能力已经配置。
 */
import { HealthResponseSchema, type HealthResponse } from '@echowave/contracts';

/** 服务器健康探测失败的稳定类别。 */
export type ServerHealthErrorCode = 'HTTP_ERROR' | 'INVALID_RESPONSE' | 'NETWORK' | 'TIMEOUT';

/** 可展示的服务器健康探测错误。 */
export class ServerHealthError extends Error {
  constructor(
    public readonly code: ServerHealthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ServerHealthError';
  }
}

/** 探测并验证指定 EchoWave Server。 */
export async function fetchServerHealth(
  serverUrl: string,
  timeoutMs = 5_000,
): Promise<HealthResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${serverUrl}/health`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new ServerHealthError('HTTP_ERROR', `服务器返回 HTTP ${response.status}。`);
    }
    const parsed = HealthResponseSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      throw new ServerHealthError('INVALID_RESPONSE', '目标不是兼容的 EchoWave Server。');
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof ServerHealthError) throw error;
    if (controller.signal.aborted) {
      throw new ServerHealthError('TIMEOUT', '连接超时，请检查服务器地址和网络。');
    }
    throw new ServerHealthError('NETWORK', '无法连接服务器，请检查地址、网络和防火墙。');
  } finally {
    clearTimeout(timeout);
  }
}
