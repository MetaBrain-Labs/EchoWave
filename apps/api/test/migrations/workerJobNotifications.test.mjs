/**
 * Worker 数据库通知迁移测试。
 *
 * 验证 019 只为既有权威任务表增加提交后唤醒信号，不创建第二套任务事实。
 *
 * Responsibilities:
 * - 锁定迁移序号、通知 payload 与四类任务触发器。
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

const migration = await readFile(
  new URL('../../migrations/019_worker_job_notifications.sql', import.meta.url),
  'utf8',
);

describe('worker job notification migration', () => {
  it('notifies every authoritative worker table without creating another queue table', () => {
    assert.match(migration, /pg_notify\(\s*'echowave_worker_jobs'/s);
    assert.match(migration, /'schema'.*'tenantId'.*'queue'/s);
    for (const trigger of [
      'ingestion_jobs_worker_notify',
      'audio_analysis_revisions_worker_notify',
      'audio_post_analysis_jobs_worker_notify',
      'audio_business_analysis_jobs_worker_notify',
    ]) {
      assert.match(migration, new RegExp(`CREATE TRIGGER ${trigger}`));
    }
    assert.doesNotMatch(migration, /CREATE TABLE/i);
  });

  it('wakes transcription for committed terminal facts and immediately due polling work', () => {
    assert.match(migration, /provider_terminal_received_at/);
    assert.match(migration, /provider_next_poll_at/);
    assert.match(migration, /clock_timestamp\(\)/);
  });
});
