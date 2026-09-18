import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  KnowledgeAnswerError,
  createKnowledgeAnswerModule,
} from '../../../dist/knowledge/answer/knowledgeAnswer.js';
import { EmbeddingProviderError } from '../../../dist/knowledge/embeddings/dashScopeEmbeddings.js';

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
    // 检索范围由 availableCategories 的版本行决定：存在且未删除的知识库才会返回。
    availableCategories: async (ids) => ({
      categories: [],
      versions: (ids ?? [knowledgeBaseId]).map((id) => ({
        id,
        version: 1,
        categoryVersion: 1,
      })),
    }),
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
      model: 'qwen3.7-text-embedding',
      estimatedCost: { amount: 0.0000035, currency: 'CNY' },
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
    // 默认不补齐依据：只有检索到段落且候选未引用任何证据时才会调用。
    groundAnswer: async () => ({ answer: '', grounded: false, citedChunkIds: [] }),
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
      embeddingModel: 'qwen3.7-text-embedding',
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

it('counts category expansion in the existing budget, reuses embeddings and persists actual scopes', async () => {
  const categoryId = '88888888-8888-4888-8888-888888888888';
  const filters = [];
  let embeddings = 0;
  const harness = createHarness({
    repositoryOverrides: {
      availableCategories: async () => ({
        categories: [
          {
            id: categoryId,
            key: 'product',
            name: '产品',
            description: 'Product facts',
            active: true,
            version: 0,
          },
        ],
        versions: [{ id: knowledgeBaseId, version: 2, categoryVersion: 1 }],
      }),
      search: async (_kb, _vector, _model, filter) => {
        filters.push(filter);
        return [];
      },
    },
    embeddingOverrides: {
      embedQueryWithUsage: async () => {
        embeddings++;
        return { vectors: [[1]], tokens: 7, provider: 'test', model: 'test' };
      },
    },
    agentOverrides: {
      generate: async ({ searchKnowledge }) => {
        await searchKnowledge('价格', { categoryIds: [categoryId] });
        assert.match((await searchKnowledge('价格', { broaden: true })).error, /Expansion/);
        await searchKnowledge('价格', { categoryIds: [categoryId] });
        assert.match((await searchKnowledge('价格')).error, /limit/);
        return {
          candidate: { answer: '不足', grounded: false, citedChunkIds: [] },
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      },
    },
  });
  try {
    await harness.answers.answer({ knowledgeBaseId, request: { question: '产品价格' } });
    assert.equal(embeddings, 1);
    assert.equal(filters.length, 3);
    assert.deepEqual(
      filters.map((filter) => filter.reason),
      ['auto', 'zero-hits', 'auto'],
    );
    const completed = harness.events.find(
      (event) => Array.isArray(event) && event[0] === 'complete',
    )[1];
    assert.equal(completed.retrievalAudit.length, 3);
    assert.equal(completed.embeddingTokens, 7);
  } finally {
    await harness.answers.dispose();
  }
});

it('never broadens an explicit category filter even if the agent asks for expansion', async () => {
  const categoryId = '88888888-8888-4888-8888-888888888888';
  const filters = [];
  const harness = createHarness({
    repositoryOverrides: {
      availableCategories: async () => ({
        categories: [
          {
            id: categoryId,
            key: 'product',
            name: '产品',
            description: 'facts',
            active: true,
            version: 0,
          },
        ],
        versions: [{ id: knowledgeBaseId, version: 1, categoryVersion: 1 }],
      }),
      search: async (_kb, _vector, _model, filter) => {
        filters.push(filter);
        return [];
      },
    },
    agentOverrides: {
      generate: async ({ searchKnowledge }) => {
        await searchKnowledge('价格', { broaden: true });
        return {
          candidate: { answer: '不足', grounded: false, citedChunkIds: [] },
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      },
    },
  });
  try {
    await harness.answers.answer({
      knowledgeBaseId,
      request: { question: '价格', categoryIds: [categoryId] },
    });
    assert.equal(filters.length, 1);
    assert.deepEqual(filters[0].categoryIds, [categoryId]);
    assert.equal(filters[0].reason, 'explicit');
  } finally {
    await harness.answers.dispose();
  }
});

it('retrieves across every requested knowledge base and audits the scope', async () => {
  const secondBaseId = '22222222-3333-4333-8333-222222222222';
  const secondChunkId = '33333333-3333-4333-8333-444444444444';
  const searched = [];
  const harness = createHarness({
    repositoryOverrides: {
      // 只把真实存在的两个库放进版本集合；未请求的范围不得进入检索。
      availableCategories: async (ids) => ({
        categories: [],
        versions: (ids ?? []).map((id) => ({ id, version: 3, categoryVersion: 2 })),
      }),
      searchMany: async (ids) => {
        searched.push([...ids]);
        return [
          {
            id: chunkId,
            knowledgeBaseId,
            documentId: '44444444-4444-4444-8444-444444444444',
            documentTitle: '研究.md',
            locator: { kind: 'markdown', headingPath: ['结论'], lineStart: 3, lineEnd: 4 },
            content: '第一个库的依据。',
          },
          {
            id: secondChunkId,
            knowledgeBaseId: secondBaseId,
            documentId: '55555555-5555-4555-8555-555555555555',
            documentTitle: '术语表.md',
            locator: { kind: 'markdown', headingPath: ['术语'], lineStart: 1, lineEnd: 2 },
            content: '第二个库的依据。',
          },
        ];
      },
    },
    agentOverrides: {
      generate: async ({ searchKnowledge }) => {
        await searchKnowledge('跨库问题');
        return {
          candidate: {
            answer: '两个库共同支持结论。[1][2]',
            grounded: true,
            citedChunkIds: [chunkId, secondChunkId],
          },
          usage: { inputTokens: 5, outputTokens: 6 },
        };
      },
    },
  });

  try {
    const response = await harness.answers.answer({
      knowledgeBaseId,
      request: { question: '跨库问题', knowledgeBaseIds: [secondBaseId] },
    });

    // 路由库与请求库合并后按字典序规范化，只检索一次跨库查询。
    assert.deepEqual(searched, [[knowledgeBaseId, secondBaseId].sort()]);
    assert.deepEqual(
      response.citations.map((citation) => citation.knowledgeBaseId),
      [knowledgeBaseId, secondBaseId],
    );
    const completed = harness.events.find(
      (event) => Array.isArray(event) && event[0] === 'complete',
    )[1];
    assert.deepEqual(
      completed.retrievalAudit[0].knowledgeBaseIds,
      [knowledgeBaseId, secondBaseId].sort(),
    );
  } finally {
    await harness.answers.dispose();
  }
});

it('rejects a knowledge base that is not available to the tenant', async () => {
  const foreignBaseId = '99999999-9999-4999-8999-999999999999';
  const harness = createHarness({
    repositoryOverrides: {
      // 只解析路由知识库：请求里额外的库在租户范围内不存在。
      availableCategories: async () => ({
        categories: [],
        versions: [{ id: knowledgeBaseId, version: 1, categoryVersion: 1 }],
      }),
    },
  });

  try {
    await assert.rejects(
      harness.answers.answer({
        knowledgeBaseId,
        request: { question: '跨库问题', knowledgeBaseIds: [foreignBaseId] },
      }),
      (error) => error.code === 'NOT_FOUND',
    );
    // 越权范围在建立会话与审计之前就被拒绝。
    assert.deepEqual(harness.events, []);
  } finally {
    await harness.answers.dispose();
  }
});

describe('trusted knowledge answer module', () => {
  it('resolves dynamic providers only when an answer is requested', async () => {
    const events = [];
    const repository = {
      availableCategories: async (ids) => ({
        categories: [],
        versions: (ids ?? [knowledgeBaseId]).map((id) => ({
          id,
          version: 1,
          categoryVersion: 1,
        })),
      }),
      getOrCreateConversation: async () => ({ id: conversationId, threadId: 'thread-dynamic' }),
      beginRun: async () => 'run-dynamic',
      search: async () => [],
      completeRun: async () => {},
      failRun: async () => {},
      listExpiredConversations: async () => [],
      deleteExpiredConversation: async () => {},
    };
    const answers = createKnowledgeAnswerModule({
      knowledgeRepository: repository,
      conversationRepository: repository,
      checkpointer: { deleteThread: async () => {} },
      resolveRuntime: async () => {
        events.push('resolve-runtime');
        return {
          embeddings: {
            embedQueryWithUsage: async () => ({
              vectors: [Array(1024).fill(0.1)],
              tokens: 1,
              provider: 'test-provider',
              model: 'qwen3.7-text-embedding',
              estimatedCost: { amount: 0, currency: 'CNY' },
            }),
          },
          agent: {
            generate: async () => ({
              candidate: { answer: '未找到依据。', grounded: false, citedChunkIds: [] },
              usage: { inputTokens: 1, outputTokens: 1 },
            }),
            correctCitations: async (candidate) => ({
              candidate,
              usage: { inputTokens: 0, outputTokens: 0 },
            }),
            groundAnswer: async () => ({ answer: '', grounded: false, citedChunkIds: [] }),
          },
          ragConfig: {
            embeddingModel: 'qwen3.7-text-embedding',
            deepSeekChatModel: 'deepseek-v4-flash',
          },
          embeddingBindingRevisionId: 'embedding-revision',
          chatBindingRevisionId: 'chat-revision',
        };
      },
      scheduleCleanup: () => () => {},
    });

    assert.deepEqual(events, []);
    await answers.answer({
      knowledgeBaseId,
      request: { question: '何时解析 Provider？' },
    });
    assert.deepEqual(events, ['resolve-runtime']);
    await answers.dispose();
  });

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

  it('grounds the answer from retrieved passages when the model cites nothing', async () => {
    const steps = [];
    const reporter = {
      start: () => ({
        recordMetadata: () => undefined,
        recordStep: (value) => steps.push(value),
        recordModelCall: () => undefined,
        recordToolCall: () => undefined,
        recordContext: () => undefined,
        recordReasoning: () => undefined,
        recordOutput: () => undefined,
        finish: async () => undefined,
      }),
    };
    const rescuedIds = [];
    const { answers } = createHarness({
      reporter,
      agentOverrides: {
        // 模型检索到了段落，却仍然宣布“没有依据”，这正是跨库问答里出现的误拒答。
        generate: async (input) => {
          await input.searchKnowledge('测试问题');
          return {
            candidate: {
              answer: '知识库中没有足够依据回答这个问题。',
              grounded: false,
              citedChunkIds: [],
            },
            usage: { inputTokens: 4, outputTokens: 5 },
          };
        },
        groundAnswer: async ({ passages }) => {
          rescuedIds.push(...passages.map((passage) => passage.chunkId));
          return {
            answer: '依据显示答案为 A。[1]',
            grounded: true,
            citedChunkIds: [passages[0].chunkId],
          };
        },
      },
    });

    const response = await answers.answer({
      knowledgeBaseId,
      request: { question: '答案是什么？' },
    });

    assert.equal(response.grounded, true);
    assert.equal(response.answer, '依据显示答案为 A。[1]');
    assert.equal(response.citations[0].chunkId, chunkId);
    assert.deepEqual(rescuedIds, [chunkId]);
    // 同名步骤含 started/completed 两条记录，只取带元数据的完成记录。
    const rescueStep = steps.find(
      (step) => step.name === 'grounding-rescue' && step.status === 'completed',
    );
    assert.equal(rescueStep.metadata.rescued, true);
    assert.equal(steps.find((step) => step.name === 'citation-validation').metadata.rescued, true);
  });

  it('still refuses when the grounding rescue finds no usable citation', async () => {
    const { answers } = createHarness({
      agentOverrides: {
        generate: async (input) => {
          await input.searchKnowledge('测试问题');
          return {
            candidate: { answer: '拒答。', grounded: false, citedChunkIds: [] },
            usage: { inputTokens: 1, outputTokens: 1 },
          };
        },
        // 补齐调用仍引用越权 ID：必须继续降级为稳定拒答。
        groundAnswer: async () => ({
          answer: '未经确认的答案。[1]',
          grounded: true,
          citedChunkIds: ['99999999-9999-4999-8999-999999999999'],
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
