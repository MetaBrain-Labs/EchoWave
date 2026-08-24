/**
 * 音频转写增量迁移测试。
 *
 * 静态锁定业务角色字段与单音频进行中任务唯一约束。
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

const migration = await readFile(
  new URL('../../migrations/004_audio_transcription.sql', import.meta.url),
  'utf8',
);

describe('audio transcription migration', () => {
  it('adds business roles and prevents concurrent active revisions', () => {
    assert.match(migration, /business_role text NOT NULL DEFAULT 'unknown'/);
    assert.match(migration, /CREATE UNIQUE INDEX audio_analysis_revisions_single_active_job_idx/);
    assert.match(migration, /status IN \('queued', 'transcribing', 'analyzing'\)/);
    assert.match(migration, /transcription_model = 'google\/gemini-2\.5-flash-lite'/);
  });
});
