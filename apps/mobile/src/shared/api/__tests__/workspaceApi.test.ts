/**
 * 音频工作区客户端测试。
 *
 * 验证共享契约解析、非法响应和普通读取请求的二十秒超时边界。
 *
 * Responsibilities:
 * - 锁定跨 feature 工作区传输行为。
 *
 * Notes:
 * - 不发起真实网络请求。
 */
import { groupFixture } from '@/test/workspaceFixtures';
import { listGroups } from '../workspaceApi';

describe('workspace API client', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('parses valid group responses and rejects incompatible payloads', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ items: [groupFixture] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    await expect(listGroups()).resolves.toEqual({ items: [groupFixture] });

    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: 'bad' }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    await expect(listGroups()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('aborts ordinary workspace reads after twenty seconds', async () => {
    jest.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    jest.spyOn(globalThis, 'fetch').mockImplementation(
      (_input, init) => new Promise((_resolve, reject) => {
        requestSignal = init?.signal ?? undefined;
        requestSignal?.addEventListener('abort', () => reject(new Error('aborted')));
      }),
    );

    const request = listGroups();
    const rejection = expect(request).rejects.toMatchObject({ code: 'TIMEOUT' });
    await jest.advanceTimersByTimeAsync(19_999);
    expect(requestSignal?.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await rejection;
    expect(requestSignal?.aborted).toBe(true);
  });
});
