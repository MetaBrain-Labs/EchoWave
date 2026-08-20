import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  KnowledgeAnswerError,
  createKnowledgeAnswerModule,
} from '../../../dist/knowledge/answer/knowledgeAnswer.js';

const knowledgeBaseId = '11111111-1111-4111-8111-111111111111';
const conversationId = '22222222-2222-4222-8222-222222222222';
const chunkId = '33333333-3333-4333-8333-333333333333';

function createHarness({ agentOverrides = {}, repositoryOverrides = {}, expired = [] } = {}) {
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
      return [{
        id: chunkId,
        documentId: '44444444-4444-4444-8444-444444444444',
        documentTitle: '研究.md',
        locator: { kind: 'markdown', headingPath: ['结论'], lineStart: 3, lineEnd: 4 },
        content: '答案为 A。',
      }];
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
    embedQueryWithUsage: async () => ({ vectors: [Array(1024).fill(0.1)], tokens: 7 }),
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
  });
  return {
    answers,
    events,
    runCleanup: () => cleanupTask?.(),
    isCancelled: () => cancelled,
  };
}

describe('trusted knowledge answer module', () => {
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
            candidate: { answer: '未经确认的答案。[1]', grounded: true, citedChunkIds: [unknownId] },
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
