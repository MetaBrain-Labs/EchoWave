/**
 * 音频 AI 执行轨迹迁移测试。
 *
 * 静态锁定安全运行、事件顺序、修订生命周期与允许类型约束。
 *
 * Responsibilities:
 * - 防止产品审计表意外保存为无边界日志结构。
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

const migration = await readFile(
  new URL('../../migrations/017_ai_execution_audit.sql', import.meta.url),
  'utf8',
);

describe('audio execution audit migration', () => {
  it('defines revision-scoped runs and ordered safe events', () => {
    assert.match(migration, /CREATE TABLE ai_execution_runs/);
    assert.match(migration, /CREATE TABLE ai_execution_events/);
    assert.match(migration, /UNIQUE \(tenant_id, execution_run_id, sequence_no\)/);
    assert.match(migration, /REFERENCES audio_analysis_revisions.*ON DELETE CASCADE/is);
  });

  it('allows only audio execution kinds and safe event categories', () => {
    for (const kind of [
      'audio-transcription',
      'audio-emotion-analysis',
      'audio-role-recognition',
      'audio-business-analysis',
    ]) {
      assert.match(migration, new RegExp(`'${kind}'`));
    }
    assert.match(migration, /event_type IN \('step', 'model_call', 'tool_call'\)/);
    assert.doesNotMatch(migration, /prompt|reasoning|model_output/i);
  });
});
