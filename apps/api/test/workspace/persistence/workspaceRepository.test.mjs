/**
 * 音频工作区只读仓储测试。
 *
 * 验证分组音频同时接受显式分享与数据源可见关系，并把数据库生命周期映射为统一状态。
 *
 * Responsibilities:
 * - 锁定租户参数、去重可见关系和失败状态映射。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { WorkspaceRepository } from '../../../dist/workspace/persistence/workspaceRepository.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const groupId = '22222222-2222-4222-8222-222222222222';
const audioId = '33333333-3333-4333-8333-333333333333';
const knowledgeId = '44444444-4444-4444-8444-444444444444';

describe('WorkspaceRepository group audio', () => {
  it('unifies explicit and data-source visibility without duplicating status facts', async () => {
    const calls = [];
    const pool = {
      query: async (sql, values) => {
        calls.push({ sql, values });
        if (calls.length === 1) {
          return { rows: [{
            id: groupId,
            name: '产品研究组',
            updated_at: new Date('2026-08-21T10:00:00.000Z'),
            analysis_count: 0,
            audio_count: 1,
            knowledge_count: 0,
            source_count: 1,
          }] };
        }
        return { rows: [{
          id: audioId,
          data_source_id: null,
          title: '待处理访谈',
          duration_ms: 10_000,
          created_at: new Date('2026-08-21T10:00:00.000Z'),
          origin_group_id: null,
          shared_from: null,
          upload_status: 'ready',
          upload_progress: 100,
          analysis_status: 'failed',
          analysis_progress: 0,
          analysis_error_stage: 'transcription',
          analysis_error_code: 'UNSUPPORTED_CODEC',
          analysis_error_message: '音频编码不支持。',
          analysis_error_retryable: false,
        }] };
      },
    };
    const repository = new WorkspaceRepository(pool, 'echowave', tenantId);

    const response = await repository.listGroupAudioFiles(groupId);

    assert.equal(response.items[0].status.kind, 'failed');
    assert.equal(response.items[0].status.stage, 'transcription');
    assert.match(calls[0].sql, /UNION/);
    assert.match(calls[1].sql, /group_audio_links/);
    assert.match(calls[1].sql, /group_data_sources/);
    assert.deepEqual(calls[1].values, [tenantId, groupId]);
  });
});

describe('WorkspaceRepository group lifecycle', () => {
  it('creates groups inside the fixed tenant with zero derived metrics', async () => {
    const calls = [];
    const pool = {
      query: async (sql, values) => {
        calls.push({ sql, values });
        return { rows: [{ id: groupId, name: '客户研究组', updated_at: new Date('2026-08-21T10:00:00.000Z') }] };
      },
    };
    const repository = new WorkspaceRepository(pool, 'echowave', tenantId);

    const created = await repository.createGroup({ name: '客户研究组' });

    assert.equal(created.name, '客户研究组');
    assert.deepEqual(created.metrics, { analysisCount: 0, audioCount: 0, knowledgeCount: 0, sourceCount: 0 });
    assert.match(calls[0].sql, /INSERT INTO/);
    assert.deepEqual(calls[0].values, [tenantId, '客户研究组']);
  });

  it('soft archives only a matching active group and rejects missing rows', async () => {
    const calls = [];
    const pool = {
      query: async (sql, values) => {
        calls.push({ sql, values });
        return { rowCount: calls.length === 1 ? 1 : 0, rows: [] };
      },
    };
    const repository = new WorkspaceRepository(pool, 'echowave', tenantId);

    await repository.archiveGroup(groupId);
    await assert.rejects(() => repository.archiveGroup(groupId), /不存在或已归档/);

    assert.match(calls[0].sql, /SET deleted_at = now\(\), updated_at = now\(\)/);
    assert.match(calls[0].sql, /deleted_at IS NULL/);
    assert.deepEqual(calls[0].values, [tenantId, groupId]);
  });
});

describe('WorkspaceRepository knowledge group links', () => {
  it('creates all links atomically and returns active linked groups', async () => {
    const clientCalls = [];
    const poolCalls = [];
    const client = {
      query: async (sql, values) => {
        clientCalls.push({ sql, values });
        if (/FROM [^\n]+\."knowledge_bases"/.test(sql)) return { rowCount: 1, rows: [{ id: knowledgeId }] };
        if (/FROM .*groups/.test(sql)) return { rowCount: 1, rows: [{ id: groupId }] };
        return { rowCount: 1, rows: [] };
      },
      release: () => { client.released = true; },
      released: false,
    };
    const pool = {
      connect: async () => client,
      query: async (sql, values) => {
        poolCalls.push({ sql, values });
        if (/FROM [^\n]+\."knowledge_bases"/.test(sql)) return { rowCount: 1, rows: [{ id: knowledgeId }] };
        if (/WITH/.test(sql)) return { rows: [{
          id: groupId,
          name: '产品研究组',
          updated_at: new Date('2026-08-21T10:00:00.000Z'),
          analysis_count: 1,
          audio_count: 2,
          knowledge_count: 1,
          source_count: 1,
        }] };
        return { rows: [{ group_id: groupId }] };
      },
    };
    const repository = new WorkspaceRepository(pool, 'echowave', tenantId);

    const response = await repository.linkKnowledgeBaseGroups(knowledgeId, { groupIds: [groupId] });

    assert.equal(response.items[0].id, groupId);
    assert.match(clientCalls[3].sql, /ON CONFLICT .* DO NOTHING/);
    assert.deepEqual(clientCalls[3].values, [tenantId, knowledgeId, [groupId]]);
    assert.equal(clientCalls.at(-1).sql, 'COMMIT');
    assert.equal(client.released, true);
  });

  it('rolls back without inserting when a requested group is missing', async () => {
    const calls = [];
    const client = {
      query: async (sql) => {
        calls.push(sql);
        if (/FROM [^\n]+\."knowledge_bases"/.test(sql)) return { rowCount: 1, rows: [{ id: knowledgeId }] };
        if (/FROM .*groups/.test(sql)) return { rowCount: 0, rows: [] };
        return { rows: [] };
      },
      release: () => {},
    };
    const repository = new WorkspaceRepository({ connect: async () => client }, 'echowave', tenantId);

    await assert.rejects(
      () => repository.linkKnowledgeBaseGroups(knowledgeId, { groupIds: [groupId] }),
      /不存在或已归档/,
    );
    assert.equal(calls.at(-1), 'ROLLBACK');
    assert.equal(calls.some((sql) => /INSERT INTO/.test(sql)), false);
  });
});
