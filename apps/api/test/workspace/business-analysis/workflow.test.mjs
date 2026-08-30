/**
 * 分组业务分析 LangGraph 工作流测试。
 *
 * 使用内存 checkpoint 验证节点级恢复、并行分支 pending writes、白名单检索与证据校验。
 *
 * Responsibilities:
 * - 证明恢复不会重复执行已完成的规划、预检索或并行成功分支。
 * - 锁定 DeepAgent 原子节点与幂等发布调用边界。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MemorySaver } from '@langchain/langgraph';

import { BusinessAnalysisProviderError } from '../../../dist/workspace/business-analysis/salesAnalysisAgent.js';
import { BusinessAnalysisWorkflow } from '../../../dist/workspace/business-analysis/workflow.js';

const groupId = '11111111-1111-4111-8111-111111111111';
const audioId = '22222222-2222-4222-8222-222222222222';
const revisionId = '33333333-3333-4333-8333-333333333333';
const confirmationId = '44444444-4444-4444-8444-444444444444';
const jobId = '55555555-5555-4555-8555-555555555555';
const segmentId = '66666666-6666-4666-8666-666666666666';
const knowledgeBaseId = '77777777-7777-4777-8777-777777777777';
const firstChunkId = '88888888-8888-4888-8888-888888888888';
const secondChunkId = '99999999-9999-4999-8999-999999999999';

function makeJob(overrides = {}) {
  return {
    id: jobId,
    audioFileId: audioId,
    groupId,
    revisionId,
    confirmationId,
    confirmationVersion: 1,
    model: 'deepseek-v4-flash',
    workflowVersion: 'langgraph-v1',
    recoveryAttempts: 0,
    knowledgeBaseIds: [knowledgeBaseId],
    knowledgeBases: [{ id: knowledgeBaseId, name: '销售知识库' }],
    settings: {
      timing: 'manual',
      contentFocus: '分析销售话术',
      tone: '正式、专业',
      customTags: [],
      settingsUpdatedAt: null,
    },
    segments: [
      {
        id: segmentId,
        speakerKey: 'Speaker 0',
        speakerLabel: '销售',
        startMs: 0,
        endMs: 1_000,
        text: '我们可以先确认你的核心顾虑。',
        role: null,
        emotion: null,
      },
    ],
    ...overrides,
  };
}

function chunk(id, content) {
  return {
    id,
    knowledgeBaseId,
    documentId: confirmationId,
    documentTitle: '销售手册',
    content,
    locator: { kind: 'markdown', headingPath: ['异议处理'], lineStart: 1, lineEnd: 2 },
    distance: 0.1,
  };
}

function recorder() {
  return {
    recordMetadata: () => {},
    recordStep: () => {},
    recordModelCall: () => {},
    recordToolCall: () => {},
    recordContext: () => {},
    recordReasoning: () => {},
    recordOutput: () => {},
    finish: async () => {},
  };
}

function publication(citedChunkIds = []) {
  return {
    limitations: [],
    summarySections: [{ title: 'overall', body: '证据充分。' }],
    tags: [
      {
        category: 'strength',
        customLabel: null,
        title: '先确认顾虑',
        summary: '回应路径清晰。',
        details: [],
        confidence: 90,
        evidenceSegmentIds: [segmentId],
        citedChunkIds,
      },
    ],
  };
}

describe('BusinessAnalysisWorkflow', () => {
  it('resumes at the atomic DeepAgent node without repeating planning or pre-retrieval', async () => {
    const calls = { plan: 0, search: 0, analyze: 0, publish: 0 };
    const firstChunk = chunk(firstChunkId, '处理异议前先确认客户顾虑。');
    const repository = {
      updateProgress: async () => {},
      publish: async (_job, result, retrieved) => {
        calls.publish += 1;
        assert.equal(result.summarySections[0].title, '总体总结');
        assert.equal(retrieved.get(firstChunkId).id, firstChunkId);
      },
    };
    const workflow = new BusinessAnalysisWorkflow({
      repository,
      checkpointer: new MemorySaver(),
      embeddings: { embedQuery: async () => [0.1] },
      embeddingModel: 'text-embedding-v4',
      knowledgeRepository: {
        searchMany: async (ids) => {
          calls.search += 1;
          assert.deepEqual(ids, [knowledgeBaseId]);
          return [firstChunk];
        },
      },
      agent: {
        planRetrievalQueries: async () => {
          calls.plan += 1;
          return ['客户异议'];
        },
        analyze: async () => {
          calls.analyze += 1;
          if (calls.analyze === 1) {
            throw new BusinessAnalysisProviderError('MODEL_TIMEOUT', '模型超时。', true);
          }
          return publication([firstChunkId]);
        },
      },
    });

    await assert.rejects(() => workflow.run(makeJob(), recorder(), () => {}));
    const result = await workflow.run(makeJob({ recoveryAttempts: 1 }), recorder(), () => {});

    assert.equal(result.resumed, true);
    assert.deepEqual(calls, { plan: 1, search: 1, analyze: 2, publish: 1 });
  });

  it('retains a successful parallel retrieval branch when its sibling fails', async () => {
    const searches = new Map();
    let secondFailed = false;
    const repository = {
      updateProgress: async () => {},
      publish: async () => {},
    };
    const workflow = new BusinessAnalysisWorkflow({
      repository,
      checkpointer: new MemorySaver(),
      embeddings: {
        embedQuery: async (query) => [query === 'first' ? 1 : 2],
      },
      embeddingModel: 'text-embedding-v4',
      knowledgeRepository: {
        searchMany: async (_ids, embedding) => {
          const key = embedding[0];
          searches.set(key, (searches.get(key) ?? 0) + 1);
          if (key === 2 && !secondFailed) {
            secondFailed = true;
            throw new Error('temporary retrieval failure');
          }
          return [
            key === 1 ? chunk(firstChunkId, '第一条知识。') : chunk(secondChunkId, '第二条知识。'),
          ];
        },
      },
      agent: {
        planRetrievalQueries: async () => ['first', 'second'],
        analyze: async ({ preRetrieved }) => {
          assert.deepEqual(
            new Set(preRetrieved.map((item) => item.id)),
            new Set([firstChunkId, secondChunkId]),
          );
          return publication();
        },
      },
    });

    await assert.rejects(() => workflow.run(makeJob(), recorder(), () => {}));
    await workflow.run(makeJob({ recoveryAttempts: 1 }), recorder(), () => {});

    assert.equal(searches.get(1), 1);
    assert.equal(searches.get(2), 2);
  });

  it('rejects fabricated transcript evidence before publication', async () => {
    let published = false;
    const workflow = new BusinessAnalysisWorkflow({
      repository: {
        updateProgress: async () => {},
        publish: async () => {
          published = true;
        },
      },
      checkpointer: new MemorySaver(),
      embeddings: { embedQuery: async () => assert.fail('zero-KB analysis must not embed') },
      embeddingModel: 'text-embedding-v4',
      knowledgeRepository: {
        searchMany: async () => assert.fail('zero-KB analysis must not search'),
      },
      agent: {
        planRetrievalQueries: async () => [],
        analyze: async () => ({
          ...publication(),
          tags: [
            {
              ...publication().tags[0],
              evidenceSegmentIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
            },
          ],
        }),
      },
    });

    await assert.rejects(
      () =>
        workflow.run(makeJob({ knowledgeBaseIds: [], knowledgeBases: [] }), recorder(), () => {}),
      (error) => error.code === 'INVALID_MODEL_OUTPUT',
    );
    assert.equal(published, false);
  });
});
