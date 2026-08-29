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

import { AudioExecutionRepository } from '../../../dist/workspace/persistence/audioExecutionRepository.js';

const audioFileId = '10000000-0000-4000-8000-000000000001';
const revisionId = '20000000-0000-4000-8000-000000000002';
const jobId = '30000000-0000-4000-8000-000000000003';
const groupId = '40000000-0000-4000-8000-000000000004';

describe('AudioExecutionRepository', () => {
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
    const repository = new AudioExecutionRepository(pool, 'public', groupId);
    const recorder = repository.createReporter().start({
      kind: 'audio-business-analysis',
      name: 'review',
      metadata: { audioFileId, revisionId, jobId, groupId },
    });
    recorder.recordReasoning('hidden chain of thought');
    recorder.recordModelCall({
      name: 'analysis',
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      status: 'completed',
      attempt: 1,
      input: { prompt: 'private transcript prompt' },
      output: { content: 'private raw model output' },
      durationMs: 20,
      inputTokens: 10,
      outputTokens: 5,
    });
    recorder.recordToolCall({
      name: 'search_knowledge',
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
      .filter((statement) => /INSERT INTO .*ai_execution_events/.test(statement.sql))
      .map((statement) => String(statement.values[8]))
      .join('\n');
    assert.match(serializedEvents, /deepseek-v4-flash/);
    assert.match(serializedEvents, /价格异议/);
    assert.doesNotMatch(
      serializedEvents,
      /hidden chain of thought|private transcript prompt|private raw model output|tool input|tool output/,
    );
  });
});
