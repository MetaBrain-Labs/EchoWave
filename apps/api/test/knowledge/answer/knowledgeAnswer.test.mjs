import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  KnowledgeAnswerError,
  createKnowledgeAnswerModule,
} from '../../../dist/knowledge/answer/knowledgeAnswer.js';
import { EmbeddingProviderError } from '../../../dist/knowledge/embeddings/openRouterEmbeddings.js';

const knowledgeBaseId = '11111111-1111-4111-8111-111111111111';
const conversationId = '22222222-2222-4222-8222-222222222222';
const chunkId = '33333333-3333-4333-8333-333333333333';

function createHarness({
  agentOverrides = {},
  createAbortSignal,
  embeddingOverrides = {},
  repositoryOverrides = {},
  expired = [],
  reporter,
} = {}) {
  const events = [];
  let cleanupTask;
  let cancelled = false;
  const repository = {
    getOrCreateConversation: async () => {
      events.push('conversation');
      return { id: conversationId, threadId: `thread-${conversationId}` };
    },
    beginRun: async () => {
      events.push('begin');
      return 'run-1';
    },
    search: async () => {
      events.push('search');
      return [
        {
          id: chunkId,
          documentId: '44444444-4444-4444-8444-444444444444',
          documentTitle: '研究.md',
          locator: { kind: 'markdown', headingPath: ['结论'], lineStart: 3, lineEnd: 4 },
          content: '答案为 A。',
        },
      ];
    },
    completeRun: async (_runId, result) => {
      events.push(['complete', result]);
    },
    failRun: async () => {
      events.push('fail');
    },
    listExpiredConversations: async () => expired,
    deleteExpiredConversation: async (id) => {
      events.push(`delete:${id}`);
    },
    ...repositoryOverrides,
  };
  const embeddings = {
    embedQueryWithUsage: async () => ({
      vectors: [Array(1024).fill(0.1)],
      tokens: 7,
      provider: 'test-provider',
      model: 'qwen/qwen3-embedding-8b',
      estimatedCostUsd: 0.00000007,
    }),
    ...embeddingOverrides,
  };
  const agent = {
    generate: async (input) => {
      events.push('generate');
      await input.searchKnowledge('测试问题');
      return {
        candidate: { answer: '依据显示答案为 A。[1]', grounded: true, citedChunkIds: [chunkId] },
        usage: { inputTokens: 10, outputTokens: 20 },
      };
    },
    correctCitations: async (candidate) => ({
      candidate,
      usage: { inputTokens: 0, outputTokens: 0 },
    }),
    ...agentOverrides,
  };
  const checkpointer = {
    deleteThread: async (threadId) => {
      events.push(`checkpoint:${threadId}`);
    },
  };
  const answers = createKnowledgeAnswerModule({
    knowledgeRepository: repository,
    conversationRepository: repository,
    embeddings,
    agent,
    checkpointer,
    ragConfig: {
      embeddingModel: 'qwen/qwen3-embedding-8b',
      deepSeekChatModel: 'deepseek-v4-flash',
    },
    scheduleCleanup: (task) => {
      cleanupTask = task;
      return () => {
        cancelled = true;
      };
    },
    now: () => 100,
    reporter,
    createAbortSignal,
  });
  return {
    answers,
    events,
    runCleanup: () => cleanupTask?.(),
    isCancelled: () => cancelled,
  };
}

describe('trusted knowledge answer module', () => {
  it('uses a forty-five second total answer signal', async () => {
    const timeouts = [];
    const controller = new AbortController();
    const { answers } = createHarness({
      createAbortSignal: (timeoutMs) => {
        timeouts.push(timeoutMs);
        return controller.signal;
      },
    });

    await answers.answer({
      knowledgeBaseId,
      request: { question: '答案是什么？' },
    });

    assert.deepEqual(timeouts, [45_000]);
  });

  it('records the trusted answer lifecycle without changing the response', async () => {
    const recorded = {
      start: undefined,
      metadata: [],
      steps: [],
      models: [],
      tools: [],
      outputs: [],
      finishes: [],
    };
    const reporter = {
      start: (input) => {
        recorded.start = input;
        return {
          recordMetadata: (value) => recorded.metadata.push(value),
          recordStep: (value) => recorded.steps.push(value),
          recordModelCall: (value) => recorded.models.push(value),
          recordToolCall: (value) => recorded.tools.push(value),
          recordContext: () => undefined,
          recordReasoning: () => undefined,
          recordOutput: (value) => recorded.outputs.push(value),
          finish: async (value) => recorded.finishes.push(value),
        };
      },
    };
    const { answers } = createHarness({ reporter });

    const response = await answers.answer({
      knowledgeBaseId,
      request: { question: '答案是什么？' },
    });

    assert.equal(response.grounded, true);
    assert.equal(recorded.start.kind, 'rag-answer');
    assert.ok(recorded.metadata.some((value) => value.ragRunId === 'run-1'));
    assert.ok(recorded.steps.some((event) => event.name === 'citation-validation'));
    assert.deepEqual(
      recorded.models.map((event) => event.name),
      ['query-embedding'],
    );
    assert.equal(recorded.tools[0].summary.hitCount, 1);
    assert.equal(recorded.outputs[0].conversationId, conversationId);
    assert.equal(recorded.finishes[0].status, 'completed');
    assert.equal(recorded.finishes[0].metadata.citationCount, 1);
  });

  it('completes the audit before returning a grounded response', async () => {
    const { answers, events } = createHarness();

    const response = await answers.answer({
      knowledgeBaseId,
      request: { question: '答案是什么？' },
    });

    assert.equal(response.grounded, true);
    assert.equal(response.citations[0].chunkId, chunkId);
    assert.deepEqual(response.usage, { embeddingTokens: 7, inputTokens: 10, outputTokens: 20 });
    assert.deepEqual(events.slice(0, 4), ['conversation', 'begin', 'generate', 'search']);
    assert.equal(events.at(-1)[0], 'complete');
  });

  it('falls back when citation correction still returns an unknown chunk', async () => {
    const unknownId = '99999999-9999-4999-8999-999999999999';
    const { answers, events } = createHarness({
      agentOverrides: {
        generate: async (input) => {
          await input.searchKnowledge('测试问题');
          return {
            candidate: {
              answer: '未经确认的答案。[1]',
              grounded: true,
              citedChunkIds: [unknownId],
            },
            usage: { inputTokens: 3, outputTokens: 4 },
          };
        },
        correctCitations: async (candidate) => ({
          candidate,
          usage: { inputTokens: 2, outputTokens: 1 },
        }),
      },
    });

    const response = await answers.answer({
      knowledgeBaseId,
      request: { question: '答案是什么？' },
    });

    assert.equal(response.grounded, false);
    assert.equal(response.answer, '知识库中没有足够依据回答这个问题。');
    assert.deepEqual(response.citations, []);
    assert.deepEqual(response.usage, { embeddingTokens: 7, inputTokens: 5, outputTokens: 5 });
    assert.deepEqual(events.at(-1)[1].citedChunkIds, []);
  });

  it('keeps an explicit insufficient-evidence answer ungrounded without correction', async () => {
    let correctionCalls = 0;
    const { answers, events } = createHarness({
      agentOverrides: {
        generate: async () => ({
          candidate: {
            answer: '知识库中没有足够依据回答这个问题。',
            grounded: false,
            citedChunkIds: [],
          },
          usage: { inputTokens: 2, outputTokens: 3 },
        }),
        correctCitations: async () => {
          correctionCalls += 1;
          throw new Error('correction must not run');
        },
      },
    });

    const response = await answers.answer({
      knowledgeBaseId,
      request: { question: '没有依据的问题？' },
    });

    assert.equal(response.grounded, false);
    assert.deepEqual(response.citations, []);
    assert.equal(correctionCalls, 0);
    assert.equal(events.at(-1)[0], 'complete');
  });

  it('appends the stable limit notice to an ungrounded answer', async () => {
    const notice = '提示：本轮检索已达到上限，回答仅基于当前已检索到的内容，证据可能不完整。';
    const { answers, events } = createHarness({
      agentOverrides: {
        generate: async () => ({
          candidate: {
            answer: '知识库中没有足够依据回答这个问题。',
            grounded: false,
            citedChunkIds: [],
          },
          usage: { inputTokens: 2, outputTokens: 3 },
          retrievalLimited: true,
          blockedRetrievalCalls: 1,
        }),
      },
    });

    const response = await answers.answer({
      knowledgeBaseId,
      request: { question: '没有依据的问题？' },
    });

    assert.equal(response.grounded, false);
    assert.deepEqual(response.citations, []);
    assert.match(response.answer, new RegExp(`${notice}$`));
    assert.equal(response.answer.match(new RegExp(notice, 'g')).length, 1);
    assert.equal(events.at(-1)[1].answer, response.answer);
  });

  it('maps an aborted query embedding to the stable timeout error', async () => {
    const { answers } = createHarness({
      embeddingOverrides: {
        embedQueryWithUsage: async () => {
          throw new EmbeddingProviderError('MODEL_TIMEOUT', '嵌入服务请求超时。');
        },
      },
    });

    await assert.rejects(
      answers.answer({ knowledgeBaseId, request: { question: '答案是什么？' } }),
      (error) => error instanceof KnowledgeAnswerError && error.code === 'MODEL_TIMEOUT',
    );
  });

  it('preserves a timeout when the secondary failure audit also fails', async () => {
    const { answers } = createHarness({
      agentOverrides: {
        generate: async () => {
          throw new DOMException('timed out', 'AbortError');
        },
      },
      repositoryOverrides: {
        failRun: async () => {
          throw new Error('audit unavailable');
        },
      },
    });

    await assert.rejects(
      answers.answer({ knowledgeBaseId, request: { question: '答案是什么？' } }),
      (error) => error instanceof KnowledgeAnswerError && error.code === 'MODEL_TIMEOUT',
    );
  });

  it('maps provider failures and records the failed run', async () => {
    const { answers, events } = createHarness({
      agentOverrides: {
        generate: async () => {
          throw new Error('provider unavailable');
        },
      },
    });

    const originalConsoleError = console.error;
    console.error = () => undefined;
    try {
      await assert.rejects(
        answers.answer({ knowledgeBaseId, request: { question: '答案是什么？' } }),
        (error) => error instanceof KnowledgeAnswerError && error.code === 'MODEL_UNAVAILABLE',
      );
    } finally {
      console.error = originalConsoleError;
    }
    assert.equal(events.at(-1), 'fail');
  });

  it('cleans checkpoints before rows and cancels scheduling on dispose', async () => {
    const first = { id: 'conversation-1', threadId: 'thread-1' };
    const second = { id: 'conversation-2', threadId: 'thread-2' };
    const { answers, events, isCancelled } = createHarness({ expired: [first, second] });

    await answers.dispose();

    assert.deepEqual(events, [
      'checkpoint:thread-1',
      'delete:conversation-1',
      'checkpoint:thread-2',
      'delete:conversation-2',
    ]);
    assert.equal(isCancelled(), true);
    await answers.dispose();
    assert.equal(isCancelled(), true);
  });
});
