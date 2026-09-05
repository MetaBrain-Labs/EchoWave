/**
 * 自动分析取消迁移测试。
 *
 * 通过静态断言确保取消字段、不可领取索引和后置分析保护不会在迁移时遗漏。
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';

const migrationPath = path.resolve('migrations/030_analysis_cancellation.sql');

describe('audio analysis cancellation migration', () => {
  it('adds cancellation flags and claim indexes to child jobs', async () => {
    const sql = await readFile(migrationPath, 'utf8');
    assert.match(
      sql,
      /audio_business_analysis_jobs[\s\S]*ADD COLUMN cancel_requested boolean NOT NULL DEFAULT false/,
    );
    assert.match(sql, /audio_business_analysis_claim_not_canceled_idx/);
    assert.match(
      sql,
      /audio_post_analysis_jobs[\s\S]*ADD COLUMN cancel_requested boolean NOT NULL DEFAULT false/,
    );
    assert.match(sql, /audio_post_analysis_claim_not_canceled_idx/);
  });
});
