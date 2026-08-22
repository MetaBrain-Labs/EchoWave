/**
 * 知识库客户端超时测试。
 *
 * 验证多轮 RAG 查询拥有独立于普通知识请求的等待窗口，并在超时后返回稳定错误。
 *
 * Responsibilities:
 * - 锁定知识问答的五十秒客户端超时。
 *
 * Notes:
 * - 不发起真实网络请求。
 */
import { queryKnowledge } from '../apiClient';

describe('knowledge query API client', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('waits fifty seconds before aborting a knowledge answer request', async () => {
    jest.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    jest.spyOn(globalThis, 'fetch').mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          requestSignal = init?.signal ?? undefined;
          requestSignal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );

    const request = queryKnowledge('11111111-1111-4111-8111-111111111111', '答案是什么？');
    const rejection = expect(request).rejects.toMatchObject({ code: 'TIMEOUT' });

    await jest.advanceTimersByTimeAsync(49_999);
    expect(requestSignal?.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(1);

    await rejection;
    expect(requestSignal?.aborted).toBe(true);
  });
});
