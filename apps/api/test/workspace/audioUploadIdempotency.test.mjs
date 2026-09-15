/**
 * 上传会话幂等恢复回归。
 *
 * 验证参数冲突与已有会话模式冻结，不依赖真实数据库。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AudioUploadSessionRepository } from '../../dist/workspace/audio/runtime-mode/uploadSessionRepository.js';
import { AudioUploadSessionService } from '../../dist/workspace/audio/runtime-mode/uploadSessionService.js';
const dataSourceId = '11111111-1111-4111-8111-111111111111';
const id = '22222222-2222-4222-8222-222222222222';
const input = {
  filename: 'phone.m4a',
  mimeType: 'audio/mp4',
  sizeBytes: 1024,
  includeAcousticEmotion: true,
  postUploadAction: 'store_only',
  idempotencyKey: 'phone-recording',
};
describe('upload idempotency', () => {
  it('rejects conflicting parameters or an archived target', async () => {
    for (const row of [
      { id, matches: false },
      { id, matches: true, archived_at: new Date() },
    ]) {
      const repository = new AudioUploadSessionRepository(
        { query: async () => ({ rows: [row] }) },
        'echowave',
        'tenant',
      );
      await assert.rejects(
        repository.findIdempotent(dataSourceId, input, null),
        (error) => error.code === 'CONFLICT',
      );
    }
  });
  it('restores persistent archive sessions despite switching the default to lightweight', async () => {
    let creates = 0;
    const old = {
      id,
      audioFileId: id,
      dataSourceId,
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: 1024,
      mode: 'hybrid',
      strategy: 'api_binary',
      status: 'uploaded',
      storageKey: 'phone.m4a',
      expiresAt: new Date('2099-01-01'),
      postUploadAction: 'store_only',
    };
    const service = new AudioUploadSessionService(
      {
        findIdempotent: async () => old,
        create: async () => {
          creates++;
        },
      },
      { get: async () => ({ mode: 'lightweight_local' }) },
      {},
      {},
      { audioStorageDirectory: '.', tempDirectory: '.', tenantId: 'tenant' },
    );
    const restored = await service.create(dataSourceId, input);
    assert.equal(restored.id, id);
    assert.equal(restored.mode, 'hybrid');
    assert.equal(restored.status, 'uploaded');
    assert.equal(creates, 0);
  });
  it('renews an expired created session without creating another asset', async () => {
    let renewed;
    const old = {
      id,
      audioFileId: id,
      dataSourceId,
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: 1024,
      mode: 'hybrid',
      strategy: 'api_binary',
      status: 'created',
      storageKey: 'original.m4a',
      expiresAt: new Date('2020-01-01'),
      postUploadAction: 'store_only',
    };
    const fresh = { ...old, expiresAt: new Date('2099-01-01') };
    const service = new AudioUploadSessionService(
      {
        findIdempotent: async () => old,
        renewExpired: async (sessionId) => {
          renewed = sessionId;
          return fresh;
        },
      },
      {},
      {},
      {},
      { audioStorageDirectory: '.', tempDirectory: '.', tenantId: 'tenant' },
    );
    const restored = await service.create(dataSourceId, input);
    assert.equal(renewed, id);
    assert.equal(restored.audioFileId, id);
    assert.equal(restored.expiresAt, fresh.expiresAt.toISOString());
  });
});
