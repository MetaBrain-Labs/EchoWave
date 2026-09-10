/**
 * 知识库客户端上传与超时测试。
 *
 * 验证原生 multipart 上传使用 expo-file-system File 并保留原始文件名，同时锁定多轮
 * RAG 查询的独立等待窗口。
 *
 * Responsibilities:
 * - 覆盖上传成功、缓存副本缺失和问答超时三类行为。
 *
 * Notes:
 * - 不发起真实网络请求；文件系统由 jest-expo 内存替身提供。
 */
import { File, Paths } from 'expo-file-system';

import { queryKnowledge, uploadDocument } from '../apiClient';
import { document, knowledge } from '../testing/fixtures';

describe('knowledge upload API client', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('uploads the picked document as multipart with its original name', async () => {
    const source = new File(Paths.cache, 'abc123.md');
    source.create();
    source.write('# 研究');
    const sourceUri = source.uri;
    const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          document: { ...document, status: { kind: 'queued' } },
          jobId: '55555555-5555-4555-8555-555555555555',
        }),
        { status: 202, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(
      uploadDocument(knowledge.id, {
        name: 'research-plan.md',
        uri: sourceUri,
        mimeType: 'text/markdown',
        size: 5,
        lastModified: 0,
      }),
    ).resolves.toMatchObject({ jobId: '55555555-5555-4555-8555-555555555555' });

    const init = fetch.mock.calls[0][1]!;
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    expect(new File(Paths.cache, 'research-plan.md').exists).toBe(true);
    expect(new File(sourceUri).exists).toBe(false);
  });

  it('rejects with FILE_UNAVAILABLE when the cached copy cannot be read', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch');

    await expect(
      uploadDocument(knowledge.id, {
        name: '缺失.md',
        uri: 'file:///mock/cache/DocumentPicker/missing-copy.md',
        mimeType: 'text/markdown',
        size: 1,
        lastModified: 0,
      }),
    ).rejects.toMatchObject({ code: 'FILE_UNAVAILABLE' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

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
