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
