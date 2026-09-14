/**
 * 收集 API 超时与响应边界回归。
 *
 * Responsibilities:
 * - 验证读取超时、重试和非法服务器输出。
 *
 * Notes:
 * - 不建立真实网络连接。
 */
import { getKnowledgeCase, listCollectionRules } from '../collectionApi';
const id = '11111111-1111-4111-8111-111111111111';
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});
test('invalid case output is rejected at the client boundary', async () => {
  jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify({ id }), { status: 200 }));
  await expect(getKnowledgeCase(id)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
});
test('read timeout aborts the request and a subsequent retry can succeed', async () => {
  jest.useFakeTimers();
  const fetch = jest
    .spyOn(globalThis, 'fetch')
    .mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
    );
  const pending = listCollectionRules(id);
  const rejection = expect(pending).rejects.toMatchObject({ code: 'TIMEOUT', retryable: true });
  await jest.advanceTimersByTimeAsync(20000);
  await rejection;
  fetch.mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200 }));
  await expect(listCollectionRules(id)).resolves.toEqual({ items: [] });
});
