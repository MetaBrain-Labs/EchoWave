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
import { audioFixtures, dataSourceDetailFixture, groupFixture } from '@/test/workspaceFixtures';
import {
  AUDIO_TRANSCRIPTION_MODEL_CAPABILITIES,
  DEFAULT_AUDIO_TRANSCRIPTION_MODEL,
} from '@echowave/contracts';
import {
  archiveDataSource,
  archiveDataSourceAudioFile,
  archiveGroup,
  createDataSource,
  createGroup,
  getAudioTranscriptionCapabilities,
  linkDataSourceGroups,
  linkKnowledgeBaseGroups,
  listGroups,
  listKnowledgeBaseGroups,
  startAudioTranscription,
  unlinkDataSourceGroup,
  updateDataSource,
  uploadDataSourceAudioFiles,
} from '../workspaceApi';

describe('workspace API client', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('parses valid group responses and rejects incompatible payloads', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [groupFixture] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await expect(listGroups()).resolves.toEqual({ items: [groupFixture] });

    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [{ id: 'bad' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await expect(listGroups()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('aborts ordinary workspace reads after twenty seconds', async () => {
    jest.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    jest.spyOn(globalThis, 'fetch').mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
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
    const fetch = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify(groupFixture), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(createGroup({ name: '  产品研究组  ' })).resolves.toEqual(groupFixture);
    expect(fetch.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        body: JSON.stringify({ name: '产品研究组' }),
        method: 'POST',
      }),
    );

    await expect(archiveGroup(groupFixture.id)).resolves.toBeUndefined();
    expect(fetch.mock.calls[1][1]).toEqual(expect.objectContaining({ method: 'DELETE' }));
  });

  it('preserves structured server errors for group writes', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: false,
          error: { code: 'NOT_FOUND', message: '分组不存在或已归档。', retryable: false },
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );

    await expect(archiveGroup(groupFixture.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: '分组不存在或已归档。',
      retryable: false,
    });
  });

  it('reads and posts knowledge-base group links with validated IDs', async () => {
    const response = { items: [groupFixture] };
    const fetch = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify(response), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(response), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    await expect(listKnowledgeBaseGroups(groupFixture.id)).resolves.toEqual(response);
    await expect(
      linkKnowledgeBaseGroups(groupFixture.id, { groupIds: [groupFixture.id] }),
    ).resolves.toEqual(response);
    expect(fetch.mock.calls[1][1]).toEqual(
      expect.objectContaining({
        body: JSON.stringify({ groupIds: [groupFixture.id] }),
        method: 'POST',
      }),
    );
    expect(() => linkKnowledgeBaseGroups(groupFixture.id, { groupIds: [] })).toThrow();
  });

  it('sends validated data-source JSON writes and accepts delete 204 responses', async () => {
    const fetch = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify(dataSourceDetailFixture), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(dataSourceDetailFixture), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await createDataSource({ name: '  本地访谈  ', description: '  用户声音  ' });
    expect(fetch.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        body: JSON.stringify({ name: '本地访谈', description: '用户声音' }),
        method: 'POST',
      }),
    );

    await updateDataSource(dataSourceDetailFixture.id, { description: '  新描述  ' });
    expect(fetch.mock.calls[1][1]).toEqual(
      expect.objectContaining({ body: JSON.stringify({ description: '新描述' }), method: 'PATCH' }),
    );
    await archiveDataSource(dataSourceDetailFixture.id);
    await unlinkDataSourceGroup(dataSourceDetailFixture.id, groupFixture.id);
    await archiveDataSourceAudioFile(dataSourceDetailFixture.id, audioFixtures[0].id);
    expect(fetch.mock.calls.slice(2).every((call) => call[1]?.method === 'DELETE')).toBe(true);
    expect(() => updateDataSource(dataSourceDetailFixture.id, {})).toThrow();
  });

  it('posts group links and multipart audio without forcing a JSON content type', async () => {
    const linkedResponse = { items: [] };
    const uploadResponse = {
      ingestionRunId: groupFixture.id,
      items: [audioFixtures.find((item) => item.status.kind === 'waiting')!],
    };
    const fetch = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify(linkedResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(uploadResponse), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    await linkDataSourceGroups(dataSourceDetailFixture.id, { groupIds: [groupFixture.id] });
    expect(fetch.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        body: JSON.stringify({ groupIds: [groupFixture.id] }),
        method: 'POST',
      }),
    );

    await uploadDataSourceAudioFiles(dataSourceDetailFixture.id, [
      {
        name: 'sample.wav',
        uri: 'file:///sample.wav',
        mimeType: 'audio/wav',
        size: 1_644,
        lastModified: 0,
      },
    ]);
    const uploadInit = fetch.mock.calls[1][1]!;
    expect(uploadInit.method).toBe('POST');
    expect(uploadInit.body).toBeInstanceOf(FormData);
    expect((uploadInit.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });

  it('starts one validated audio transcription revision', async () => {
    const response = {
      audioFileId: audioFixtures[0].id,
      revisionId: dataSourceDetailFixture.id,
      status: 'queued' as const,
    };
    const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(response), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(
      startAudioTranscription(audioFixtures[0].id, {
        model: 'x-ai/grok-stt-1.0',
        preprocessing: 'direct',
      }),
    ).resolves.toEqual(response);
    expect(fetch.mock.calls[0][0]).toContain(
      `/api/audio-files/${audioFixtures[0].id}/transcriptions`,
    );
    expect(fetch.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        body: JSON.stringify({ model: 'x-ai/grok-stt-1.0', preprocessing: 'direct' }),
        method: 'POST',
      }),
    );
  });

  it('parses audio transcription capabilities', async () => {
    const capabilities = {
      defaultModel: DEFAULT_AUDIO_TRANSCRIPTION_MODEL,
      models: AUDIO_TRANSCRIPTION_MODEL_CAPABILITIES,
      ffmpeg: { configured: false, available: false },
      direct: {
        maxBytes: 209_715_200 as const,
        maxDurationMs: 45_000 as const,
        formats: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'webm'] as const,
      },
    };
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(capabilities), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(getAudioTranscriptionCapabilities()).resolves.toEqual(capabilities);
  });
});
