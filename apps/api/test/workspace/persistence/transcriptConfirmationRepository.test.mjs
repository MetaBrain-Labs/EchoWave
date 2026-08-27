/**
 * 转写确认仓储测试。
 *
 * 验证完整确认快照、乐观版本冲突以及 Raw Transcript 不可变约束。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { WorkspaceRepositoryError } from '../../../dist/workspace/persistence/errors.js';
import { TranscriptConfirmationRepository } from '../../../dist/workspace/persistence/transcriptConfirmationRepository.js';

const tenantId = '00000000-0000-4000-8000-000000000001';
const audioId = '11111111-1111-4111-8111-111111111111';
const revisionId = '22222222-2222-4222-8222-222222222222';
const firstSegmentId = '33333333-3333-4333-8333-333333333333';
const secondSegmentId = '44444444-4444-4444-8444-444444444444';
const confirmationId = '55555555-5555-4555-8555-555555555555';

describe('TranscriptConfirmationRepository', () => {
  it('publishes one complete snapshot without updating raw transcript rows', async () => {
    const calls = [];
    const client = {
      query: async (sql, values) => {
        calls.push({ sql, values });
        if (/SELECT ar.id AS revision_id/.test(sql)) {
          return { rows: [{ revision_id: revisionId, current_version: null }] };
        }
        if (/SELECT id FROM .*transcript_segments/.test(sql)) {
          return { rows: [{ id: firstSegmentId }, { id: secondSegmentId }] };
        }
        if (/INSERT INTO .*transcript_confirmations/.test(sql)) {
          return {
            rows: [{ id: confirmationId, confirmed_at: new Date('2026-08-28T01:00:00.000Z') }],
          };
        }
        return { rows: [], rowCount: 1 };
      },
      release: () => {},
    };
    const repository = new TranscriptConfirmationRepository(
      { connect: async () => client },
      'echowave',
      tenantId,
    );

    const response = await repository.confirm(audioId, {
      analysisRevisionId: revisionId,
      baseVersion: 0,
      segments: [
        { segmentId: firstSegmentId, text: '修正一' },
        { segmentId: secondSegmentId, text: '修正二' },
      ],
    });

    assert.equal(response.version, 1);
    assert.equal(response.confirmationId, confirmationId);
    assert.equal(
      calls.filter(({ sql }) => /INSERT INTO .*transcript_confirmation_segments/.test(sql)).length,
      2,
    );
    assert.ok(calls.some(({ sql }) => /SET active_transcript_confirmation_id = \$3/.test(sql)));
    assert.equal(
      calls.some(({ sql }) => /UPDATE .*transcript_segments[\s\S]*SET/.test(sql)),
      false,
    );
    assert.equal(calls.at(-1).sql, 'COMMIT');
  });

  it('increments the immutable confirmation version on a later correction', async () => {
    const client = {
      query: async (sql) => {
        if (/SELECT ar.id AS revision_id/.test(sql)) {
          return { rows: [{ revision_id: revisionId, current_version: 1 }] };
        }
        if (/SELECT id FROM .*transcript_segments/.test(sql)) {
          return { rows: [{ id: firstSegmentId }] };
        }
        if (/INSERT INTO .*transcript_confirmations/.test(sql)) {
          return {
            rows: [{ id: confirmationId, confirmed_at: new Date('2026-08-28T02:00:00.000Z') }],
          };
        }
        return { rows: [], rowCount: 1 };
      },
      release: () => {},
    };
    const repository = new TranscriptConfirmationRepository(
      { connect: async () => client },
      'echowave',
      tenantId,
    );

    const response = await repository.confirm(audioId, {
      analysisRevisionId: revisionId,
      baseVersion: 1,
      segments: [{ segmentId: firstSegmentId, text: '第二次确认' }],
    });
    assert.equal(response.version, 2);
  });

  it('rejects stale versions before publication', async () => {
    const calls = [];
    const client = {
      query: async (sql, values) => {
        calls.push({ sql, values });
        if (/SELECT ar.id AS revision_id/.test(sql)) {
          return { rows: [{ revision_id: revisionId, current_version: 2 }] };
        }
        return { rows: [] };
      },
      release: () => {},
    };
    const repository = new TranscriptConfirmationRepository(
      { connect: async () => client },
      'echowave',
      tenantId,
    );

    await assert.rejects(
      () =>
        repository.confirm(audioId, {
          analysisRevisionId: revisionId,
          baseVersion: 1,
          segments: [{ segmentId: firstSegmentId, text: '过期修改' }],
        }),
      (error) => error instanceof WorkspaceRepositoryError && error.code === 'CONFLICT',
    );
    assert.equal(
      calls.some(({ sql }) => /INSERT INTO/.test(sql)),
      false,
    );
    assert.equal(calls.at(-1).sql, 'ROLLBACK');
  });

  it('rejects an incomplete segment set before creating a confirmation', async () => {
    const calls = [];
    const client = {
      query: async (sql, values) => {
        calls.push({ sql, values });
        if (/SELECT ar.id AS revision_id/.test(sql)) {
          return { rows: [{ revision_id: revisionId, current_version: null }] };
        }
        if (/SELECT id FROM .*transcript_segments/.test(sql)) {
          return { rows: [{ id: firstSegmentId }, { id: secondSegmentId }] };
        }
        return { rows: [] };
      },
      release: () => {},
    };
    const repository = new TranscriptConfirmationRepository(
      { connect: async () => client },
      'echowave',
      tenantId,
    );

    await assert.rejects(
      () =>
        repository.confirm(audioId, {
          analysisRevisionId: revisionId,
          baseVersion: 0,
          segments: [{ segmentId: firstSegmentId, text: '只提交一个片段' }],
        }),
      (error) => error instanceof WorkspaceRepositoryError && error.code === 'CONFLICT',
    );
    assert.equal(
      calls.some(({ sql }) => /INSERT INTO/.test(sql)),
      false,
    );
  });
});
