/**
 * 数据源 PostgreSQL Repository 测试。
 *
 * 验证数据源关联、软归档与上传批次事务。
 *
 * Responsibilities:
 * - 锁定数据源与分组关系的事务语义。
 * - 验证音频上传元数据发布。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PostgresDataSourceRepository } from '../../../dist/workspace/data-sources/postgresDataSourceRepository.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const groupId = '22222222-2222-4222-8222-222222222222';
const audioId = '33333333-3333-4333-8333-333333333333';
const knowledgeId = '44444444-4444-4444-8444-444444444444';

const groupCatalog = { listGroups: async () => ({ items: [] }) };

describe('PostgresDataSourceRepository data-source lifecycle', () => {
  it('links active groups atomically and ignores duplicate relations', async () => {
    const calls = [];
    const client = {
      query: async (sql, values) => {
        calls.push({ sql, values });
        if (/FROM .*data_sources/.test(sql)) return { rowCount: 1, rows: [{ id: audioId }] };
        if (/FROM .*groups/.test(sql)) return { rowCount: 1, rows: [{ id: groupId }] };
        return { rowCount: 1, rows: [] };
      },
      release: () => {},
    };
    const repository = new PostgresDataSourceRepository(
      { connect: async () => client },
      'echowave',
      tenantId,

      groupCatalog,
    );
    repository.listDataSourceGroups = async () => ({ items: [] });

    await repository.linkDataSourceGroups(audioId, { groupIds: [groupId] });

    const insert = calls.find((call) => /INSERT INTO .*group_data_sources/.test(call.sql));
    assert.match(insert.sql, /ON CONFLICT .* DO NOTHING/);
    assert.deepEqual(insert.values, [tenantId, audioId, [groupId]]);
    assert.equal(calls.at(-1).sql, 'COMMIT');
  });

  it('rolls back a complete link batch when any group is unavailable', async () => {
    const calls = [];
    const client = {
      query: async (sql) => {
        calls.push(sql);
        if (/FROM .*data_sources/.test(sql)) return { rowCount: 1, rows: [{ id: audioId }] };
        if (/FROM .*groups/.test(sql)) return { rowCount: 0, rows: [] };
        return { rows: [] };
      },
      release: () => {},
    };
    const repository = new PostgresDataSourceRepository(
      { connect: async () => client },
      'echowave',
      tenantId,

      groupCatalog,
    );

    await assert.rejects(
      () => repository.linkDataSourceGroups(audioId, { groupIds: [groupId] }),
      /不存在或已归档/,
    );
    assert.equal(calls.at(-1), 'ROLLBACK');
    assert.equal(
      calls.some((sql) => /INSERT INTO/.test(sql)),
      false,
    );
  });

  it('soft archives only active sources and source-owned audio', async () => {
    const calls = [];
    const pool = {
      query: async (sql, values) => {
        calls.push({ sql, values });
        if (/audio_analysis_revisions/.test(sql)) return { rowCount: 0, rows: [] };
        return {
          rowCount:
            calls.filter((call) => !/audio_analysis_revisions/.test(call.sql)).length <= 2 ? 1 : 0,
          rows: [{ id: audioId }],
        };
      },
    };
    const repository = new PostgresDataSourceRepository(pool, 'echowave', tenantId, groupCatalog);

    await repository.archiveDataSource(audioId);
    await repository.archiveDataSourceAudioFile(audioId, groupId);
    await assert.rejects(() => repository.archiveDataSource(audioId), /不存在或已归档/);

    assert.match(calls[0].sql, /SET deleted_at = now\(\), updated_at = now\(\)/);
    assert.match(calls[2].sql, /af\.data_source_id = \$2 AND af\.id = \$3/);
    assert.deepEqual(calls[2].values, [tenantId, audioId, groupId]);
  });

  it('publishes one successful ingestion run and ordered waiting audio in one transaction', async () => {
    const calls = [];
    const client = {
      query: async (sql, values) => {
        calls.push({ sql, values });
        if (/SELECT id FROM .*data_sources/.test(sql))
          return { rowCount: 1, rows: [{ id: audioId }] };
        if (/INSERT INTO .*data_source_ingestion_runs/.test(sql))
          return { rows: [{ id: groupId }] };
        if (/INSERT INTO .*audio_files/.test(sql))
          return {
            rows: [
              {
                id: knowledgeId,
                title: values[3],
                duration_ms: values[7],
                created_at: new Date('2026-08-21T10:00:00.000Z'),
              },
            ],
          };
        return { rowCount: 1, rows: [] };
      },
      release: () => {},
    };
    const repository = new PostgresDataSourceRepository(
      { connect: async () => client },
      'echowave',
      tenantId,

      groupCatalog,
    );

    const response = await repository.createDataSourceAudioUpload(audioId, [
      {
        title: '客户访谈',
        originalFilename: 'customer.wav',
        mimeType: 'audio/wav',
        sizeBytes: 1_644,
        durationMs: 100,
        storageKey: 'stored.wav',
      },
    ]);

    assert.equal(response.ingestionRunId, groupId);
    assert.equal(response.items[0].status.kind, 'waiting');
    assert.match(calls.find((call) => /audio_files/.test(call.sql)).sql, /'ready', 100/);
    assert.equal(calls.at(-1).sql, 'COMMIT');
  });
});
