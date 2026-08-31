/**
 * 音频执行轨迹仓储测试。
 *
 * 验证 PostgreSQL 产品审计只保存允许字段，不吸收通用报告器中的敏感正文。
 *
 * Responsibilities:
 * - 锁定模型输入输出与隐藏 reasoning 不落产品审计的边界。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PostgresAudioExecutionRepository } from '../../../dist/workspace/audio/execution/postgresAudioExecutionRepository.js';

const audioFileId = '10000000-0000-4000-8000-000000000001';
const revisionId = '20000000-0000-4000-8000-000000000002';
const jobId = '30000000-0000-4000-8000-000000000003';
const groupId = '40000000-0000-4000-8000-000000000004';

describe('PostgresAudioExecutionRepository', () => {
  it('persists only safe model and retrieval audit details', async () => {
    const statements = [];
    const client = {
      query: async (sql, values = []) => {
        statements.push({ sql, values });
        return { rows: [], rowCount: 1 };
      },
      release: () => undefined,
    };
    const pool = {
      query: client.query,
      connect: async () => client,
    };
    const repository = new PostgresAudioExecutionRepository(pool, 'public', groupId);
    const recorder = repository.createReporter().start({
      kind: 'audio-business-analysis',
      name: 'review',
      metadata: { audioFileId, revisionId, jobId, groupId },
    });
    recorder.recordReasoning('unattached hidden chain of thought');
    const modelCall = recorder.beginModelCall({
      name: 'analysis',
      displayName: '生成业务分析',
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      attempt: 1,
      reasoningMode: 'streaming',
    });
    modelCall.appendReasoning(
      `visible streamed reasoning C:\\Users\\private\\audio.wav https://oss.test/a?Signature=secret ${'A'.repeat(300)}`,
    );
    modelCall.finish({
      status: 'completed',
      input: { prompt: 'private transcript prompt' },
      output: { content: 'private raw model output' },
      durationMs: 20,
      inputTokens: 10,
      outputTokens: 5,
    });
    const toolCall = recorder.beginToolCall({
      name: 'search_knowledge',
      displayName: '检索分组关联知识库',
      summary: {
        audit: {
          query: '价格异议',
          knowledgeBases: [{ id: groupId, name: '销售知识库' }],
          hitCount: 0,
          hits: [],
        },
      },
    });
    toolCall.finish({
      status: 'completed',
      summary: {
        audit: {
          query: '价格异议',
          knowledgeBases: [{ id: groupId, name: '销售知识库' }],
          hitCount: 0,
          hits: [],
        },
      },
      input: { secret: 'tool input' },
      output: { secret: 'tool output' },
    });
    await recorder.finish({ status: 'completed' });

    const serializedEvents = statements
      .filter(
        (statement) =>
          /INSERT INTO .*ai_execution_events/.test(statement.sql) && statement.values.length >= 10,
      )
      .map((statement) => String(statement.values[9]))
      .join('\n');
    const persistedEventTypes = statements
      .filter(
        (statement) =>
          /INSERT INTO .*ai_execution_events/.test(statement.sql) && statement.values.length >= 10,
      )
      .map((statement) => `${statement.values[4]}:${statement.values[6]}`);
    assert.match(serializedEvents, /deepseek-v4-flash/);
    assert.match(serializedEvents, /价格异议/);
    assert.match(serializedEvents, /visible streamed reasoning/);
    assert.match(serializedEvents, /REDACTED_PATH|REDACTED_BASE64/);
    assert.doesNotMatch(
      serializedEvents,
      /unattached hidden chain of thought|private transcript prompt|private raw model output|tool input|tool output|Signature=secret|audio\.wav|A{256}/,
    );
    assert.deepEqual(persistedEventTypes.slice(0, 4), [
      'run:started',
      'model_call:started',
      'reasoning_delta:started',
      'model_call:completed',
    ]);
  });

  it('chunks and truncates one model reasoning stream at 120000 characters', async () => {
    const statements = [];
    const client = {
      query: async (sql, values = []) => {
        statements.push({ sql, values });
        return { rows: [], rowCount: 1 };
      },
      release: () => undefined,
    };
    const repository = new PostgresAudioExecutionRepository(
      { query: client.query, connect: async () => client },
      'public',
      groupId,
    );
    const recorder = repository.createReporter().start({
      kind: 'audio-business-analysis',
      name: 'review',
      metadata: { audioFileId, revisionId, jobId, groupId },
    });
    const modelCall = recorder.beginModelCall({
      name: 'business-analysis-generation',
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      attempt: 1,
      reasoningMode: 'streaming',
    });
    modelCall.appendReasoning('思'.repeat(120_010));
    modelCall.finish({
      status: 'completed',
      input: {},
      output: {},
      durationMs: 1,
      inputTokens: null,
      outputTokens: null,
    });
    await recorder.finish({ status: 'completed' });

    const reasoningDetails = statements
      .filter(
        (statement) =>
          /INSERT INTO .*ai_execution_events/.test(statement.sql) &&
          statement.values[4] === 'reasoning_delta',
      )
      .map((statement) => JSON.parse(statement.values[9]));
    assert.equal(
      reasoningDetails.reduce((total, item) => total + item.delta.length, 0),
      120_000,
    );
    assert.ok(reasoningDetails.every((item) => item.delta.length <= 512));
    assert.equal(reasoningDetails.at(-1).truncated, true);
  });

  it('never propagates audit persistence failures to the workflow', async () => {
    const client = {
      query: async (sql) => {
        if (/^(BEGIN|ROLLBACK)$/.test(sql)) return { rows: [], rowCount: 0 };
        throw new Error('database unavailable');
      },
      release: () => undefined,
    };
    const repository = new PostgresAudioExecutionRepository(
      { query: client.query, connect: async () => client },
      'public',
      groupId,
    );
    const recorder = repository.createReporter().start({
      kind: 'audio-business-analysis',
      name: 'review',
      metadata: { audioFileId, revisionId, jobId, groupId },
    });
    recorder.recordStep({ name: 'start', status: 'started' });

    await assert.doesNotReject(() => recorder.finish({ status: 'completed' }));
  });

  it('maps cursor events to complete in-place model call payloads', async () => {
    const runId = '50000000-0000-4000-8000-000000000005';
    const operationId = '60000000-0000-4000-8000-000000000006';
    const occurredAt = '2026-08-29T01:00:00.000Z';
    const event = {
      id: operationId,
      execution_run_id: runId,
      operation_id: operationId,
      sequence_no: 2,
      stream_cursor: '18',
      event_type: 'model_call',
      name: 'business-analysis-generation',
      status: 'started',
      occurred_at: occurredAt,
      duration_ms: null,
      details: {
        displayName: '结合转写与知识证据生成业务分析',
        provider: 'deepseek',
        model: 'deepseek-v4-flash',
        attempt: 1,
        reasoningMode: 'streaming',
      },
    };
    const pool = {
      connect: async () => assert.fail('stream reads must not open a transaction'),
      query: async (sql) => {
        if (/UPDATE .*ai_execution_runs/s.test(sql)) return { rows: [], rowCount: 0 };
        if (/event\.stream_cursor >/.test(sql)) return { rows: [event], rowCount: 1 };
        if (/SELECT id, kind, name/.test(sql)) {
          return {
            rows: [
              {
                id: runId,
                kind: 'audio-business-analysis',
                name: 'review',
                phase: null,
                status: 'running',
                group_id: groupId,
                source_job_id: jobId,
                started_at: occurredAt,
                completed_at: null,
                duration_ms: null,
                error_code: null,
                error_message: null,
                error_retryable: null,
              },
            ],
            rowCount: 1,
          };
        }
        if (/execution_run_id = ANY/.test(sql)) return { rows: [event], rowCount: 1 };
        assert.fail(`unexpected SQL: ${sql}`);
      },
    };
    const repository = new PostgresAudioExecutionRepository(pool, 'public', groupId);
    const events = await repository.getStreamEvents(audioFileId, revisionId, groupId, '17');

    assert.equal(events[0].type, 'model-start');
    assert.equal(events[0].modelCall.name, '结合转写与知识证据生成业务分析');
    assert.equal(events[0].modelCall.status, 'running');
    assert.equal(events[0].modelCall.reasoningContent, '');
  });
});
