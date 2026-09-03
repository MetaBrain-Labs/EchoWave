/**
 * 音频运行模式服务测试。
 *
 * 锁定混合默认值、依赖就绪判定、管理员授权和配置 revision 透传。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AudioRuntimeService } from '../../dist/workspace/audio/runtime-mode/service.js';
import { SettingsError } from '../../dist/settings/types.js';

function repository(overrides = {}) {
  let stored = {
    mode: 'hybrid',
    revision: 1,
    originalRetentionDays: null,
    intermediateRetentionHours: 24,
  };
  return {
    get: async () => stored,
    update: async (input) => {
      stored = {
        mode: input.mode,
        revision: stored.revision + 1,
        ...input.retention,
      };
      return stored;
    },
    ...overrides,
  };
}

function settings(missing = new Set()) {
  return {
    authorize: (authorization) => {
      if (authorization !== 'Bearer admin') throw new SettingsError('UNAUTHORIZED', '未授权。');
    },
    resolveCapability: async (capability) => {
      if (missing.has(capability)) {
        throw new SettingsError('CONFIGURATION_REQUIRED', `${capability} 未配置。`);
      }
      return {};
    },
  };
}

const readyPreprocessor = {
  capabilities: () => ({
    ffmpeg: { configured: true, available: true },
    sileroVad: { model: 'silero-vad-v5', available: true, unavailableReason: null },
  }),
};

describe('AudioRuntimeService', () => {
  it('returns hybrid as the default and reports all configured modes available', async () => {
    const service = new AudioRuntimeService(repository(), settings(), readyPreprocessor);
    const overview = await service.overview();
    assert.equal(overview.mode, 'hybrid');
    assert.deepEqual(
      overview.modes.map(({ mode, available }) => ({ mode, available })),
      [
        { mode: 'hybrid', available: true },
        { mode: 'object_storage', available: true },
        { mode: 'lightweight_local', available: true },
      ],
    );
  });

  it('blocks object storage without its authoritative OSS binding', async () => {
    const service = new AudioRuntimeService(
      repository(),
      settings(new Set(['audio_primary_storage'])),
      readyPreprocessor,
    );
    const overview = await service.overview();
    const objectMode = overview.modes.find(({ mode }) => mode === 'object_storage');
    assert.equal(objectMode.available, false);
    assert.match(objectMode.unavailableReason, /权威音频对象存储/);
    await assert.rejects(
      () =>
        service.update('Bearer admin', {
          mode: 'object_storage',
          expectedRevision: 1,
          retention: { originalRetentionDays: 30, intermediateRetentionHours: 24 },
        }),
      { code: 'CONFIGURATION_REQUIRED' },
    );
  });

  it('requires the administrator token and increments the stored revision', async () => {
    const service = new AudioRuntimeService(repository(), settings(), readyPreprocessor);
    await assert.rejects(
      () =>
        service.update(undefined, {
          mode: 'lightweight_local',
          expectedRevision: 1,
          retention: { originalRetentionDays: null, intermediateRetentionHours: 24 },
        }),
      { code: 'UNAUTHORIZED' },
    );
    const updated = await service.update('Bearer admin', {
      mode: 'lightweight_local',
      expectedRevision: 1,
      retention: { originalRetentionDays: null, intermediateRetentionHours: 24 },
    });
    assert.equal(updated.mode, 'lightweight_local');
    assert.equal(updated.revision, 2);
  });
});
