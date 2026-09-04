/**
 * 统一分析运行记录契约测试。
 *
 * 覆盖合法判别联合与状态/类型查询的非法输入，防止客户端筛选漂移。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AudioAnalysisRunSchema, AudioAnalysisRunsQuerySchema } from '@echowave/contracts';

const id = '11111111-1111-4111-8111-111111111111';

describe('audio analysis run contracts', () => {
  it('parses batch and manual records', () => {
    const timestamp = '2026-09-04T00:00:00.000Z';
    assert.equal(
      AudioAnalysisRunSchema.parse({
        kind: 'batch',
        id,
        title: '销售组',
        groupId: id,
        status: 'completed_with_warnings',
        progress: 100,
        scheduledFor: null,
        counts: {
          total: 1,
          active: 0,
          blocked: 0,
          completed: 1,
          partial: 1,
          failed: 0,
          canceled: 0,
        },
        updatedAt: timestamp,
      }).kind,
      'batch',
    );
    assert.equal(
      AudioAnalysisRunSchema.parse({
        kind: 'manual_audio',
        id,
        audioFileId: id,
        groupId: null,
        title: '录音',
        status: 'completed',
        phase: 'done',
        progress: 100,
        reportAvailable: true,
        warningCodes: [],
        error: null,
        updatedAt: timestamp,
      }).kind,
      'manual_audio',
    );
  });

  it('rejects unsupported filters and limits', () => {
    assert.throws(() => AudioAnalysisRunsQuerySchema.parse({ status: 'unknown' }));
    assert.throws(() => AudioAnalysisRunsQuerySchema.parse({ limit: 51 }));
  });
});
