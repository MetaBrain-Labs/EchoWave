/**
 * 轻量声学补跑源文件清理回归。
 *
 * 验证候选选取后出现排队任务时，加锁复查仍保护原件。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AudioSourceLifecycle } from '../../dist/workspace/audio/runtime-mode/sourceLifecycle.js';
describe('AudioSourceLifecycle', () => {
  it('checks active acoustic and batch work under the source lock before deleting', async () => {
    const calls = [];
    const row = {
      id: '11111111-1111-4111-8111-111111111111',
      storage_key: 'original.m4a',
      storage_backend: 'aliyun_oss',
      storage_binding_revision_id: 'binding',
    };
    let released = false;
    let deleted = false;
    const client = {
      query: async (sql) => {
        calls.push(sql);
        if (/FOR UPDATE OF af/.test(sql)) return { rows: [row], rowCount: 1 };
        if (/UNION ALL/.test(sql)) return { rows: [{}], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      },
      release: () => {
        released = true;
      },
    };
    const lifecycle = new AudioSourceLifecycle(
      { query: async () => ({ rows: [row] }), connect: async () => client },
      'echowave',
      'tenant',
      '.',
    );
    await lifecycle.cleanupDue(async () => ({
      delete: async () => {
        deleted = true;
      },
    }));
    assert.equal(deleted, false);
    assert.equal(released, true);
    assert.match(calls[1], /FOR UPDATE OF af/);
    assert.match(calls[2], /audio_post_analysis_jobs/);
    assert.match(calls[2], /audio_analysis_tasks/);
    assert.equal(calls.at(-1), 'COMMIT');
    assert.ok(calls.every((sql) => !/source_state = 'cleaned'/.test(sql)));
  });
  it('cleans terminal originals and commits the source state', async () => {
    const calls = [];
    let deleted;
    const row = {
      id: '11111111-1111-4111-8111-111111111111',
      storage_key: 'original.m4a',
      storage_backend: 'aliyun_oss',
      storage_binding_revision_id: 'binding',
    };
    const client = {
      query: async (sql) => {
        calls.push(sql);
        return /FOR UPDATE OF af/.test(sql)
          ? { rows: [row], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      },
      release: () => {},
    };
    const lifecycle = new AudioSourceLifecycle(
      { query: async () => ({ rows: [row] }), connect: async () => client },
      'echowave',
      'tenant',
      '.',
    );
    await lifecycle.cleanupDue(async () => ({
      delete: async (key) => {
        deleted = key;
      },
    }));
    assert.equal(deleted, row.storage_key);
    assert.ok(calls.some((sql) => /source_state = 'cleaned'/.test(sql)));
    assert.equal(calls.at(-1), 'COMMIT');
  });
});
