/**
 * 统一分析运行记录查询测试。
 *
 * 锁定手动音频聚合所需的 Speaker Review 关联，避免只读列表查询引用不存在的 SQL 别名。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AudioAnalysisRunsRepository } from '../../../dist/workspace/audio/analysis-runs/repository.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const audioId = '22222222-2222-4222-8222-222222222222';
const revisionId = '33333333-3333-4333-8333-333333333333';
const businessId = '44444444-4444-4444-8444-444444444444';

describe('AudioAnalysisRunsRepository', () => {
  it('joins speaker review jobs when aggregating a manual audio run', async () => {
    const calls = [];
    const repository = new AudioAnalysisRunsRepository(
      {
        query: async (sql, values) => {
          calls.push({ sql, values });
          return {
            rows: [
              {
                audio_file_id: audioId,
                title: '客户访谈',
                group_id: null,
                revision_id: revisionId,
                revision_status: 'ready',
                revision_progress: 100,
                revision_error_code: null,
                revision_error_message: null,
                revision_error_retryable: null,
                revision_updated_at: '2026-09-04T00:00:00.000Z',
                emotion_status: null,
                emotion_error_code: null,
                role_status: null,
                role_error_code: null,
                business_status: 'ready',
                business_id: businessId,
                business_head_job_id: businessId,
                business_progress: 100,
                business_error_code: null,
                business_error_message: null,
                business_error_retryable: null,
                business_limitations: [],
                speaker_status: 'ready',
                speaker_finding_count: 0,
              },
            ],
          };
        },
      },
      'echowave',
      tenantId,
    );

    const result = await repository.list({ kind: 'manual_audio', status: 'all', limit: 50 });

    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].reportAvailable, true);
    assert.match(calls[0].sql, /FROM .*audio_speaker_review_jobs.* review/s);
    assert.deepEqual(calls[0].values, [tenantId]);
  });
});
