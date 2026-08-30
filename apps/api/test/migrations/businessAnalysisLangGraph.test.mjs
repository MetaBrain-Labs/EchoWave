/**
 * 业务分析 LangGraph 迁移测试。
 *
 * 静态锁定持久化恢复、退避调度与终态 checkpoint 补偿清理所需字段。
 *
 * Responsibilities:
 * - 防止工作流版本、恢复计数、到期时间和清理标记在迁移维护中遗漏。
 *
 * Notes:
 * - PostgreSQL 实际执行仍由显式 migrate 命令验证。
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

const migration = await readFile(
  new URL('../../migrations/020_business_analysis_langgraph.sql', import.meta.url),
  'utf8',
);

describe('business analysis LangGraph migration', () => {
  it('adds versioned recovery scheduling and cleanup state', () => {
    assert.match(migration, /workflow_version text NOT NULL DEFAULT 'langgraph-v1'/i);
    assert.match(migration, /recovery_attempts smallint NOT NULL DEFAULT 0/i);
    assert.match(migration, /CHECK \(recovery_attempts BETWEEN 0 AND 2\)/i);
    assert.match(migration, /next_attempt_at timestamptz/i);
    assert.match(migration, /checkpoint_cleanup_pending boolean NOT NULL DEFAULT false/i);
  });

  it('indexes only queued jobs for due-time claims', () => {
    assert.match(migration, /audio_business_analysis_due_idx/i);
    assert.match(migration, /\(tenant_id, next_attempt_at, created_at\)/i);
    assert.match(migration, /WHERE status = 'queued'/i);
  });
});
