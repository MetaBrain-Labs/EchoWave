/**
 * 自动分析与推送 migration 静态契约测试。
 *
 * 锁定 PostgreSQL 权威队列、到点领取索引、幂等约束和通知 outbox。
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

const automation = await readFile(
  new URL('../../migrations/028_audio_analysis_automation.sql', import.meta.url),
  'utf8',
);
const notifications = await readFile(
  new URL('../../migrations/029_push_notifications.sql', import.meta.url),
  'utf8',
);
const automationNotifyFix = await readFile(
  new URL('../../migrations/031_fix_audio_analysis_automation_notify.sql', import.meta.url),
  'utf8',
);

describe('audio analysis automation migrations', () => {
  it('defines the authoritative batch and task state machine', () => {
    assert.match(automation, /CREATE TABLE audio_analysis_batches/);
    assert.match(automation, /CREATE TABLE audio_analysis_tasks/);
    for (const status of [
      'awaiting_upload',
      'scheduled',
      'queued',
      'running',
      'hard_blocked',
      'completed_with_warnings',
      'failed',
      'canceled',
    ]) {
      assert.match(automation, new RegExp(`'${status}'`));
    }
    assert.match(automation, /audio_analysis_tasks_due_idx/);
    assert.match(automation, /audio_analysis_batch_blockers_active_idx/);
    assert.match(automation, /'audio-analysis-automation'/);
  });

  it('defines fixed-tenant devices and a retryable per-device outbox', () => {
    assert.match(notifications, /CREATE TABLE push_devices/);
    assert.match(notifications, /CREATE TABLE notification_events/);
    assert.match(notifications, /CREATE TABLE notification_deliveries/);
    assert.match(notifications, /UNIQUE \(tenant_id, dedupe_key\)/);
    assert.match(notifications, /'HARD_BLOCKED'.*'FAILED'.*'COMPLETED'.*'PARTIAL_COMPLETED'/s);
    assert.match(notifications, /'push-notifications'/);
  });

  it('does not dereference phase on child job tables without that field', () => {
    assert.match(automationNotifyFix, /to_jsonb\(NEW\)/);
    assert.match(automationNotifyFix, /TG_TABLE_NAME = 'audio_analysis_tasks'/);
    assert.doesNotMatch(automationNotifyFix, /OLD\.phase|NEW\.phase/);
  });
});
