/**
 * 分组销售复盘 Worker 测试。
 *
 * 验证主动检索与 Agent 工具检索共享同一知识库白名单，并拒绝虚构证据标识。
 *
 * Responsibilities:
 * - 锁定白名单检索、零知识库和发布前证据校验行为。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BusinessAnalysisWorker,
  buildBusinessRetrievalQueries,
} from '../../../dist/workspace/business-analysis/worker.js';

const groupId = '11111111-1111-4111-8111-111111111111';
const audioId = '22222222-2222-4222-8222-222222222222';
const revisionId = '33333333-3333-4333-8333-333333333333';
const confirmationId = '44444444-4444-4444-8444-444444444444';
const jobId = '55555555-5555-4555-8555-555555555555';
const segmentId = '66666666-6666-4666-8666-666666666666';
const knowledgeBaseId = '77777777-7777-4777-8777-777777777777';
const chunkId = '88888888-8888-4888-8888-888888888888';

function makeJob(overrides = {}) {
  return {
    id: jobId,
    audioFileId: audioId,
    groupId,
    revisionId,
    confirmationId,
    confirmationVersion: 1,
    model: 'deepseek-v4-flash',
    knowledgeBaseIds: [knowledgeBaseId],
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

async function waitUntil(predicate) {
  for (let attempt = 0; attempt < 100 && !predicate(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('BusinessAnalysisWorker', () => {
  it('builds no more than three bounded proactive retrieval queries', () => {
    const queries = buildBusinessRetrievalQueries(
      '关注销售表现',
      Array.from({ length: 20 }, (_, index) => ({ text: `片段${index}${'内容'.repeat(300)}` })),
    );
    assert.equal(queries.length, 3);
    assert.ok(queries.every((query) => query.length <= 3_110));
  });

  it('uses the immutable knowledge-base whitelist for proactive and tool searches', async () => {
    const whitelistCalls = [];
    let claimed = false;
    let published;
    let failure;
    const repository = {
      resetInterrupted: async () => {},
      claim: async () => {
        if (claimed) return undefined;
        claimed = true;
        return makeJob();
      },
      updateProgress: async () => {},
      publish: async (_job, result) => {
        published = result;
      },
      fail: async (_job, code) => {
        failure = code;
      },
    };
    const chunk = {
      id: chunkId,
      knowledgeBaseId,
      documentId: confirmationId,
      documentTitle: '销售手册',
      content: '处理异议前先确认客户顾虑。',
      locator: { kind: 'markdown', headingPath: ['异议处理'], lineStart: 1, lineEnd: 2 },
      distance: 0.1,
    };
    const worker = new BusinessAnalysisWorker({
      repository,
      embeddings: { embedQuery: async () => [0.1, 0.2] },
      embeddingModel: 'text-embedding-v4',
      knowledgeRepository: {
        searchMany: async (knowledgeBaseIds) => {
          whitelistCalls.push(knowledgeBaseIds);
          return [chunk];
        },
      },
      agent: {
        planRetrievalQueries: async () => ['客户异议 处理方法'],
        analyze: async ({ searchKnowledge }) => {
          await searchKnowledge('补充检索');
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
                citedChunkIds: [chunkId],
              },
            ],
          };
        },
      },
    });
    await worker.start();
    await waitUntil(() => published || failure);
    await worker.stop();
    assert.equal(failure, undefined);
    assert.ok(published);
    assert.equal(published.summarySections[0].title, '总体总结');
    assert.ok(whitelistCalls.length >= 2);
    assert.ok(
      whitelistCalls.every(
        (ids) => ids === makeJob().knowledgeBaseIds || ids[0] === knowledgeBaseId,
      ),
    );
  });

  it('rejects a fabricated transcript segment without replacing the published head', async () => {
    let claimed = false;
    let published = false;
    let failure;
    const repository = {
      resetInterrupted: async () => {},
      claim: async () => {
        if (claimed) return undefined;
        claimed = true;
        return makeJob({ knowledgeBaseIds: [] });
      },
      updateProgress: async () => {},
      publish: async () => {
        published = true;
      },
      fail: async (_job, code) => {
        failure = code;
      },
    };
    const worker = new BusinessAnalysisWorker({
      repository,
      embeddings: { embedQuery: async () => assert.fail('zero-KB analysis must not embed') },
      embeddingModel: 'text-embedding-v4',
      knowledgeRepository: {
        searchMany: async () => assert.fail('zero-KB analysis must not search'),
      },
      agent: {
        planRetrievalQueries: async () => ['不会执行的零知识库查询'],
        analyze: async () => ({
          limitations: [],
          summarySections: [{ title: 'overall', body: '待校验。' }],
          tags: [
            {
              category: 'risk',
              customLabel: null,
              title: '未知证据',
              summary: '引用了不存在的片段。',
              details: [],
              confidence: 70,
              evidenceSegmentIds: ['99999999-9999-4999-8999-999999999999'],
              citedChunkIds: [],
            },
          ],
        }),
      },
    });
    await worker.start();
    await waitUntil(() => failure);
    await worker.stop();
    assert.equal(failure, 'INVALID_MODEL_OUTPUT');
    assert.equal(published, false);
  });
});
