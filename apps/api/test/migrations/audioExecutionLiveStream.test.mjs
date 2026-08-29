/**
 * 音频执行实时流迁移测试。
 *
 * 验证 018 只扩展既有审计事件，并提供调用关联与可断线续传的全局游标。
 *
 * Responsibilities:
 * - 锁定迁移序号、事件类型、旧数据回填和索引约束。
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

const migration = await readFile(
  new URL('../../migrations/018_ai_execution_live_stream.sql', import.meta.url),
  'utf8',
);

describe('audio execution live stream migration', () => {
  it('adds a stable operation id and a resumable stream cursor', () => {
    assert.match(migration, /ADD COLUMN operation_id uuid/);
    assert.match(migration, /SET operation_id = id/);
    assert.match(migration, /stream_cursor bigint GENERATED ALWAYS AS IDENTITY/);
    assert.match(migration, /ai_execution_events_stream_cursor_idx/);
  });

  it('allows run lifecycle and reasoning delta events without editing 017', () => {
    assert.match(migration, /'run'.*'reasoning_delta'/s);
    assert.match(migration, /'interrupted'/);
    assert.doesNotMatch(migration, /CREATE TABLE ai_execution_runs/);
  });
});
