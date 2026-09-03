/**
 * 音频上传会话服务测试。
 *
 * 验证上传已经发布但首次 ASR 尚未排队时，重复 complete 会幂等补偿且保留声学开关。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AudioUploadSessionService } from '../../dist/workspace/audio/runtime-mode/uploadSessionService.js';

const session = {
  id: '11111111-1111-4111-8111-111111111111',
  audioFileId: '22222222-2222-4222-8222-222222222222',
  dataSourceId: '33333333-3333-4333-8333-333333333333',
  mode: 'lightweight_local',
  strategy: 'api_binary',
  filename: 'meeting.wav',
  mimeType: 'audio/wav',
  sizeBytes: 1_024,
  storageKey: 'temporary.wav',
  storageBindingRevisionId: null,
  includeAcousticEmotion: false,
  status: 'ready',
  expiresAt: new Date('2099-01-01T00:00:00.000Z'),
};

describe('AudioUploadSessionService', () => {
  it('repairs the ready-to-ASR interruption without creating duplicate runs', async () => {
    const starts = [];
    let hasRun = false;
    const audio = {
      listAudioTranscriptions: async () => ({
        selectionMode: 'auto',
        activeRevisionId: null,
        items: hasRun ? [{ id: 'revision' }] : [],
      }),
      startAudioTranscription: async (audioFileId, input) => {
        starts.push({ audioFileId, input });
        hasRun = true;
      },
    };
    const service = new AudioUploadSessionService({ get: async () => session }, {}, {}, audio, {
      audioStorageDirectory: '.',
      tempDirectory: '.',
      tenantId: 'tenant',
    });

    assert.deepEqual(await service.complete(session.id), {
      audioFileId: session.audioFileId,
      status: 'ready',
    });
    await service.complete(session.id);

    assert.equal(starts.length, 1);
    assert.equal(starts[0].audioFileId, session.audioFileId);
    assert.equal(starts[0].input.includeAcousticEmotion, false);
    assert.equal(starts[0].input.preprocessing, 'silero_vad');
  });
});
