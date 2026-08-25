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
const diagnosticsMigration = await readFile(
  new URL('../../migrations/005_audio_transcription_diagnostics.sql', import.meta.url),
  'utf8',
);
const progressMigration = await readFile(
  new URL('../../migrations/006_audio_transcription_progress.sql', import.meta.url),
  'utf8',
);
const splittingMigration = await readFile(
  new URL('../../migrations/007_audio_transcription_splitting_stage.sql', import.meta.url),
  'utf8',
);
const sttModelMigration = await readFile(
  new URL('../../migrations/008_openrouter_stt_models.sql', import.meta.url),
  'utf8',
);

describe('audio transcription migration', () => {
  it('adds business roles and prevents concurrent active revisions', () => {
    assert.match(migration, /business_role text NOT NULL DEFAULT 'unknown'/);
    assert.match(migration, /CREATE UNIQUE INDEX audio_analysis_revisions_single_active_job_idx/);
    assert.match(migration, /status IN \('queued', 'transcribing', 'analyzing'\)/);
    assert.match(migration, /transcription_model = 'google\/gemini-2\.5-flash-lite'/);
  });

  it('adds nullable structured failure diagnostics', () => {
    assert.match(diagnosticsMigration, /ADD COLUMN error_details jsonb/);
    assert.match(diagnosticsMigration, /jsonb_typeof\(error_details\) = 'object'/);
  });

  it('adds constrained persisted chunk activity for resumable polling', () => {
    assert.match(progressMigration, /ADD COLUMN processing_stage text/);
    assert.match(progressMigration, /ADD COLUMN current_chunk integer/);
    assert.match(progressMigration, /num_nonnulls\(current_chunk, chunk_count/);
    assert.match(progressMigration, /current_chunk >= 1 AND current_chunk <= chunk_count/);
    assert.match(progressMigration, /network_attempt BETWEEN 1 AND 3/);
    assert.match(progressMigration, /structure_attempt BETWEEN 1 AND 3/);
    assert.match(progressMigration, /processing_stage = CASE/);
  });

  it('allows the adaptive splitting activity stage', () => {
    assert.match(
      splittingMigration,
      /DROP CONSTRAINT audio_analysis_revisions_processing_stage_check/,
    );
    assert.match(splittingMigration, /'splitting'/);
  });

  it('updates data-source defaults without rewriting historical revisions', () => {
    assert.match(sttModelMigration, /UPDATE data_sources/);
    assert.match(sttModelMigration, /transcription_model = 'x-ai\/grok-stt-1\.0'/);
    assert.doesNotMatch(sttModelMigration, /audio_analysis_revisions/);
  });
});
