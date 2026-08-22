/**
 * 音频工作区迁移契约测试。
 *
 * 静态验证新增 migration 包含全部权威实体、租户复合外键和版本发布约束。
 *
 * Responsibilities:
 * - 防止表、约束或关键状态检查在后续维护中被意外遗漏。
 *
 * Notes:
 * - PostgreSQL 实际执行由显式 migrate 命令验证。
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

const migration = await readFile(
  new URL('../../migrations/002_audio_workspace.sql', import.meta.url),
  'utf8',
);

describe('audio workspace migration', () => {
  it('defines every workspace fact table without demo inserts', () => {
    for (const table of [
      'groups',
      'group_knowledge_bases',
      'data_sources',
      'group_data_sources',
      'data_source_ingestion_runs',
      'audio_files',
      'group_audio_links',
      'audio_analysis_revisions',
      'analysis_scenes',
      'transcript_segments',
      'analysis_invalid_segments',
      'analysis_summary_sections',
      'segment_ai_tags',
    ]) {
      assert.match(migration, new RegExp(`CREATE TABLE ${table} \\(`));
    }
    assert.doesNotMatch(migration, /INSERT INTO/);
  });

  it('enforces tenant-consistent links and active analysis ownership', () => {
    assert.match(migration, /FOREIGN KEY \(tenant_id, group_id\)/);
    assert.match(migration, /FOREIGN KEY \(tenant_id, data_source_id\)/);
    assert.match(migration, /FOREIGN KEY \(tenant_id, audio_file_id\)/);
    assert.match(migration, /FOREIGN KEY \(tenant_id, id, active_analysis_revision_id\)/);
    assert.match(migration, /REFERENCES audio_analysis_revisions\(tenant_id, audio_file_id, id\)/);
  });

  it('locks progress, timeline ordering and string-array tag details', () => {
    assert.match(migration, /upload_progress BETWEEN 0 AND 100/);
    assert.match(migration, /progress BETWEEN 0 AND 100/);
    assert.match(migration, /CHECK \(end_ms > start_ms\)/);
    assert.match(migration, /jsonb_path_exists\(details/);
  });
});
