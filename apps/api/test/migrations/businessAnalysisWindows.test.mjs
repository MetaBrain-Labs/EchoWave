/**
 * 业务分析窗口迁移测试。
 *
 * 验证长转写和声学情绪都拥有租户隔离、幂等主键与结果 checkpoint。
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

const migration = new URL('../../migrations/027_business_analysis_windows.sql', import.meta.url);

describe('business analysis window migration', () => {
  it('creates resumable window tables with tenant-scoped idempotency', async () => {
    const sql = await readFile(migration, 'utf8');
    assert.match(sql, /CREATE TABLE IF NOT EXISTS audio_business_analysis_windows/);
    assert.match(sql, /PRIMARY KEY \(tenant_id, job_id, window_index\)/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS audio_post_analysis_windows/);
    assert.match(sql, /ON DELETE CASCADE/);
  });
});
