/**
 * 音频运行模式迁移静态契约测试。
 *
 * 锁定混合默认值、资产存储快照、ASR Checkpoint 与可恢复上传边界。
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

const migration = await readFile(
  new URL('../../migrations/024_audio_runtime_modes.sql', import.meta.url),
  'utf8',
);
const repairMigration = await readFile(
  new URL('../../migrations/025_lightweight_transcript_confirmation_repair.sql', import.meta.url),
  'utf8',
);
const timelineRepairMigration = await readFile(
  new URL('../../migrations/026_lightweight_transcript_timeline_repair.sql', import.meta.url),
  'utf8',
);

describe('audio runtime modes migration', () => {
  it('defaults existing and new tenants and assets to hybrid mode', () => {
    assert.match(migration, /mode text NOT NULL DEFAULT 'hybrid'/);
    assert.match(migration, /INSERT INTO tenant_audio_runtime_settings/);
    assert.match(migration, /ADD COLUMN runtime_mode text NOT NULL DEFAULT 'hybrid'/);
    assert.match(migration, /ADD COLUMN storage_backend text NOT NULL DEFAULT 'local_persistent'/);
  });

  it('persists source lifecycle, storage binding and transcript selection state', () => {
    assert.match(migration, /ADD COLUMN storage_binding_revision_id uuid/);
    assert.match(migration, /ADD COLUMN source_sha256 varchar\(64\)/);
    assert.match(migration, /ADD COLUMN source_delete_after timestamptz/);
    assert.match(migration, /ADD COLUMN transcript_selection_mode text NOT NULL DEFAULT 'auto'/);
    assert.match(migration, /CREATE TABLE audio_upload_sessions/);
    assert.match(migration, /include_acoustic_emotion boolean NOT NULL DEFAULT true/);
    assert.match(migration, /retry_count integer NOT NULL DEFAULT 0/);
  });

  it('enumerates every resumable ASR and cleanup checkpoint', () => {
    for (const checkpoint of [
      'source_validated',
      'preprocessing_ready',
      'provider_staged',
      'provider_submitted',
      'provider_terminal',
      'transcript_published',
      'acoustic_emotion_completed',
      'cleanup_completed',
    ]) {
      assert.match(migration, new RegExp(`'${checkpoint}'`));
    }
    assert.match(migration, /bundled_emotion_job_id uuid/);
    assert.match(migration, /origin IN \('user_confirmed', 'system_raw_snapshot'\)/);
  });

  it('repairs lightweight snapshots and active pointers idempotently', () => {
    assert.match(repairMigration, /origin\)\s*SELECT[\s\S]*system_raw_snapshot/);
    assert.match(repairMigration, /transcript_confirmation_segments/);
    assert.match(repairMigration, /ON CONFLICT DO NOTHING/);
    assert.match(repairMigration, /active_transcript_confirmation_id IS NULL/);
    assert.match(repairMigration, /active_emotion_job_id = ar\.bundled_emotion_job_id/);
  });

  it('repairs timeline ordering for already-applied lightweight snapshots', () => {
    assert.match(timelineRepairMigration, /SET part_index =/);
    assert.match(timelineRepairMigration, /tc\.origin = 'system_raw_snapshot'/);
    assert.match(timelineRepairMigration, /af\.runtime_mode = 'lightweight_local'/);
    assert.match(timelineRepairMigration, /raw\.segment_index/);
  });
});
