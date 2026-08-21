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
import {
  archiveGroup,
  createGroup,
  linkKnowledgeBaseGroups,
  listGroups,
  listKnowledgeBaseGroups,
} from '../workspaceApi';

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

  it('sends validated group creation JSON and accepts archive 204 responses', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(groupFixture), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(createGroup({ name: '  产品研究组  ' })).resolves.toEqual(groupFixture);
    expect(fetch.mock.calls[0][1]).toEqual(expect.objectContaining({
      body: JSON.stringify({ name: '产品研究组' }),
      method: 'POST',
    }));

    await expect(archiveGroup(groupFixture.id)).resolves.toBeUndefined();
    expect(fetch.mock.calls[1][1]).toEqual(expect.objectContaining({ method: 'DELETE' }));
  });

  it('preserves structured server errors for group writes', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      ok: false,
      error: { code: 'NOT_FOUND', message: '分组不存在或已归档。', retryable: false },
    }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    }));

    await expect(archiveGroup(groupFixture.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: '分组不存在或已归档。',
      retryable: false,
    });
  });

  it('reads and posts knowledge-base group links with validated IDs', async () => {
    const response = { items: [groupFixture] };
    const fetch = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    await expect(listKnowledgeBaseGroups(groupFixture.id)).resolves.toEqual(response);
    await expect(linkKnowledgeBaseGroups(groupFixture.id, { groupIds: [groupFixture.id] })).resolves.toEqual(response);
    expect(fetch.mock.calls[1][1]).toEqual(expect.objectContaining({
      body: JSON.stringify({ groupIds: [groupFixture.id] }),
      method: 'POST',
    }));
    expect(() => linkKnowledgeBaseGroups(groupFixture.id, { groupIds: [] })).toThrow();
  });
});
