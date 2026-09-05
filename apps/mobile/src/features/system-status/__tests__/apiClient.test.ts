/**
 * EchoWave Server 健康探测测试。
 *
 * 验证成功响应、无效负载、HTTP 错误和超时被转换为稳定客户端结果。
 *
 * Responsibilities:
 * - 覆盖连接探测的网络信任边界。
 *
 * Notes:
 * - 所有 fetch 响应均由测试替身提供。
 */
import { fetchServerHealth, ServerHealthError } from '../apiClient';

const validHealth = {
  name: 'EchoWave' as const,
  service: 'echowave-api' as const,
  version: '0.1.0',
  apiVersion: 1 as const,
  status: 'ok' as const,
  capabilities: { remotePush: false },
};

describe('fetchServerHealth', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('validates and returns a successful response', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => validHealth,
    } as Response);

    await expect(fetchServerHealth('http://localhost:3001')).resolves.toEqual(validHealth);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:3001/health',
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    );
  });

  it('separates invalid contracts and HTTP failures', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ message: 'unexpected' }),
    } as Response);
    await expect(fetchServerHealth('http://localhost:3001')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    } satisfies Partial<ServerHealthError>);

    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: false, status: 503 } as Response);
    await expect(fetchServerHealth('http://localhost:3001')).rejects.toMatchObject({
      code: 'HTTP_ERROR',
    } satisfies Partial<ServerHealthError>);
  });

  it('turns an aborted request into a timeout error', async () => {
    jest.useFakeTimers();
    jest.spyOn(globalThis, 'fetch').mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );

    const request = fetchServerHealth('http://localhost:3001', 20);
    const rejection = expect(request).rejects.toMatchObject({ code: 'TIMEOUT' });
    await jest.advanceTimersByTimeAsync(20);
    await rejection;
  });
});
