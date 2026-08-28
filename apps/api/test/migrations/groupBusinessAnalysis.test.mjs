/**
 * 分组业务分析迁移测试。
 *
 * 静态锁定设置、不可变任务快照、多片段标签和原子发布指针所需的数据结构。
 *
 * Responsibilities:
 * - 防止白名单、版本化结果或多对多证据关系在迁移维护中遗漏。
 *
 * Notes:
 * - PostgreSQL 实际执行仍由显式 migrate 命令验证。
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

const migration = await readFile(
  new URL('../../migrations/014_group_business_analysis.sql', import.meta.url),
  'utf8',
);

describe('group business analysis migration', () => {
  it('defines versioned settings, jobs, results, labels and citations', () => {
    for (const table of [
      'group_analysis_settings',
      'audio_business_analysis_jobs',
      'audio_group_business_analysis_heads',
      'business_analysis_summary_sections',
      'business_analysis_tags',
      'business_analysis_tag_segments',
      'business_analysis_citations',
    ]) {
      assert.match(migration, new RegExp(`CREATE TABLE ${table} \\(`));
    }
  });

  it('pins confirmation, settings and knowledge whitelist snapshots', () => {
    assert.match(migration, /transcript_confirmation_id uuid NOT NULL/i);
    assert.match(migration, /confirmation_version integer NOT NULL/i);
    assert.match(migration, /settings_snapshot jsonb NOT NULL/i);
    assert.match(migration, /knowledge_base_ids uuid\[\] NOT NULL/i);
    assert.match(migration, /input_fingerprint text NOT NULL/i);
  });

  it('keeps one current result pointer while preserving many historical jobs', () => {
    assert.match(migration, /PRIMARY KEY \(tenant_id, group_id, audio_file_id\)/);
    assert.match(migration, /active_job_id uuid NOT NULL/i);
    assert.match(migration, /CREATE UNIQUE INDEX uq_audio_business_analysis_running/);
    assert.match(migration, /CREATE TABLE business_analysis_tag_segments/);
  });
});
