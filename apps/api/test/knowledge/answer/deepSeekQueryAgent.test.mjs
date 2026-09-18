import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MemorySaver } from '@langchain/langgraph';

import { createKnowledgeAnswerModule } from '../../../dist/knowledge/answer/knowledgeAnswer.js';
import { DeepSeekQueryAgent } from '../../../dist/knowledge/answer/deepSeekQueryAgent.js';
import { answerCitationNumbers } from '../../../dist/knowledge/answer/citationMarkers.js';
import { parseJsonObject } from '../../../dist/knowledge/answer/structuredOutput.js';

const kbId = '11111111-1111-4111-8111-111111111111';
const conversationId = '22222222-2222-4222-8222-222222222222';
const chunkId = '33333333-3333-4333-8333-333333333333';
const retrievalLimitNotice =
  '提示：本轮检索已达到上限，回答仅基于当前已检索到的内容，证据可能不完整。';

function chatCompletion({ content, toolCalls } = {}) {
  const message = { role: 'assistant', content: content ?? null };
  if (toolCalls) message.tool_calls = toolCalls;
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: 1,
    model: 'deepseek-v4-flash',
    choices: [{ index: 0, message, finish_reason: toolCalls ? 'tool_calls' : 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  };
}

function searchToolCall(id, query = `测试问题 ${id}`) {
  return {
    id,
    type: 'function',
    function: { name: 'search_knowledge', arguments: JSON.stringify({ query }) },
  };
}

/**
 * Builds the trusted-answer module with stubbed persistence/embeddings and a fake
 * DeepSeek transport. The fake provider first answers with a search_knowledge
 * tool call, then with the given final answer; an optional correction answer
 * serves the citation-correction model call.
 */
function createHarness({
  enableThinking,
  finalAnswer,
  correctionAnswer,
  reporter,
  scriptedResponses,
  searchChunks,
}) {
  const requests = [];
  let searchCalls = 0;
  let embeddingCalls = 0;
  const fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    const index = requests.length - 1;
    if (scriptedResponses) {
      const response = scriptedResponses[index];
      if (!response) throw new Error(`Missing scripted response at index ${index}.`);
      return Response.json(response);
    }
    if (index === 0) {
      return Response.json(
        chatCompletion({
          toolCalls: [searchToolCall('call_1', '测试问题')],
        }),
      );
    }
    if (index === 1) return Response.json(chatCompletion({ content: finalAnswer }));
    return Response.json(chatCompletion({ content: correctionAnswer }));
  };

  const checkpointer = new MemorySaver();
  const repository = {
    // 检索范围由 availableCategories 的版本行决定，测试桩按请求的库返回版本。
    availableCategories: async (ids) => ({
      categories: [],
      versions: (ids ?? [kbId]).map((id) => ({ id, version: 1, categoryVersion: 1 })),
    }),
    getOrCreateConversation: async () => ({
      id: conversationId,
      threadId: `thread-${conversationId}`,
    }),
    beginRun: async () => 'run-1',
    search: async () => {
      searchCalls += 1;
      return (
        searchChunks ?? [
          {
            id: chunkId,
            documentId: '44444444-4444-4444-8444-444444444444',
            documentTitle: '研究.md',
            locator: { kind: 'markdown', headingPath: ['结论'], lineStart: 3, lineEnd: 4 },
            content: '答案为 A。',
          },
        ]
      );
    },
    completeRun: async () => undefined,
    failRun: async () => undefined,
    listExpiredConversations: async () => [],
    deleteExpiredConversation: async () => undefined,
  };
  const embeddings = {
    embedQueryWithUsage: async () => {
      embeddingCalls += 1;
      return {
        vectors: [Array(1024).fill(0.1)],
        tokens: 7,
        provider: 'test-provider',
        model: 'qwen3.7-text-embedding',
        estimatedCost: { amount: 0.0000035, currency: 'CNY' },
      };
    },
  };
  const agent = new DeepSeekQueryAgent({
    ragConfig: {
      tenantId: '00000000-0000-4000-8000-000000000001',
      dashScope: {
        apiKey: 'dashscope-test-key',
        baseUrl: 'https://workspace.example.com/api/v1',
      },
      embeddingModel: 'qwen3.7-text-embedding',
      embeddingDimensions: 1024,
      deepSeekApiKey: 'deepseek-test-key',
      deepSeekBaseUrl: 'http://deepseek.test',
      deepSeekChatModel: 'deepseek-v4-flash',
      enableThinking,
      langGraphSchema: 'echowave_graph',
      uploadTempDir: '.tmp/uploads',
    },
    checkpointer,
    fetchImplementation: fetch,
  });
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
    scheduleCleanup: () => () => undefined,
    reporter,
  });

  return {
    answers,
    requests,
    getSearchCalls: () => searchCalls,
    getEmbeddingCalls: () => embeddingCalls,
  };
}

describe('parseJsonObject', () => {
  it('parses a plain JSON object', () => {
    assert.deepEqual(parseJsonObject('{"answer":"A","grounded":true}'), {
      answer: 'A',
      grounded: true,
    });
  });

  it('parses a fully fenced JSON block', () => {
    assert.deepEqual(parseJsonObject('```json\n{"answer":"B"}\n```'), { answer: 'B' });
  });

  it('parses JSON surrounded by prose and markdown fences', () => {
    const text =
      'Here is the answer:\n```json\n{"answer":"C","grounded":false,"citedChunkIds":[]}\n```\nHope this helps.';
    assert.deepEqual(parseJsonObject(text), { answer: 'C', grounded: false, citedChunkIds: [] });
  });

  it('returns the last complete object when prose follows', () => {
    assert.deepEqual(parseJsonObject('thinking... {"answer":"D"} trailing'), { answer: 'D' });
  });

  it('returns null for truncated JSON', () => {
    assert.equal(parseJsonObject('{"answer": "unfinished'), null);
  });

  it('returns null for empty text', () => {
    assert.equal(parseJsonObject(''), null);
  });
});

describe('KnowledgeQueryAgent DeepSeek thinking-mode compatibility', () => {
  it('drops earlier turns retrieval transcripts so stale passages cannot be cited', async () => {
    const firstAnswer = JSON.stringify({
      answer: '上一个库的依据。[1]',
      grounded: true,
      citedChunkIds: [chunkId],
    });
    const secondAnswer = JSON.stringify({
      answer: '本轮的术语依据。[1]',
      grounded: true,
      citedChunkIds: [chunkId],
    });
    const { answers, requests } = createHarness({
      enableThinking: false,
      scriptedResponses: [
        chatCompletion({ toolCalls: [searchToolCall('call_1')] }),
        chatCompletion({ content: firstAnswer }),
        chatCompletion({ toolCalls: [searchToolCall('call_2')] }),
        chatCompletion({ content: secondAnswer }),
      ],
    });

    const first = await answers.answer({
      knowledgeBaseId: kbId,
      request: { question: '第一个库有什么？' },
    });
    await answers.answer({
      knowledgeBaseId: kbId,
      request: { question: '第二个库有什么？', conversationId: first.conversationId },
    });

    // 第二轮请求携带的多轮上下文里不得残留上一轮的 tool 消息与工具调用助手消息。
    const followUp = requests.at(-2);
    const firstTurn = requests[1];
    assert.equal(firstTurn.messages.filter((message) => message.role === 'tool').length, 1);
    assert.deepEqual(
      followUp.messages.map((message) => message.role),
      ['system', 'user', 'assistant', 'user'],
    );
    assert.equal(followUp.messages.filter((message) => message.role === 'tool').length, 0);
    // 历史轮次只保留问题及其最终回答，答案正文仍在上下文里。
    assert.ok(String(followUp.messages[2].content).includes('上一个库'));
  });

  it('blocks a fifth sequential search and completes from the four retrieved results', async () => {
    const toolEvents = [];
    const finishes = [];
    const reporter = {
      start: () => ({
        recordMetadata: () => undefined,
        recordStep: () => undefined,
        recordModelCall: () => undefined,
        recordToolCall: (value) => toolEvents.push(value),
        recordContext: () => undefined,
        recordReasoning: () => undefined,
        recordOutput: () => undefined,
        finish: async (value) => finishes.push(value),
      }),
    };
    const finalAnswer = JSON.stringify({
      answer: '已有证据支持答案为 A。[1]',
      grounded: true,
      citedChunkIds: [chunkId],
    });
    const scriptedResponses = [
      chatCompletion({ toolCalls: [searchToolCall('call_1')] }),
      chatCompletion({ toolCalls: [searchToolCall('call_2')] }),
      chatCompletion({ toolCalls: [searchToolCall('call_3')] }),
      chatCompletion({ toolCalls: [searchToolCall('call_4')] }),
      chatCompletion({ toolCalls: [searchToolCall('call_5')] }),
      chatCompletion({ content: finalAnswer }),
    ];
    const { answers, requests, getSearchCalls, getEmbeddingCalls } = createHarness({
      enableThinking: false,
      scriptedResponses,
      reporter,
    });

    const result = await answers.answer({
      knowledgeBaseId: kbId,
      request: { question: '答案是什么？' },
    });

    assert.equal(getSearchCalls(), 4);
    assert.equal(getEmbeddingCalls(), 4);
    assert.equal(requests.length, 6);
    assert.equal(result.grounded, true);
    assert.match(result.answer, new RegExp(`${retrievalLimitNotice}$`));
    assert.equal(result.answer.match(new RegExp(retrievalLimitNotice, 'g')).length, 1);
    assert.ok(JSON.stringify(requests[0].messages).includes('at most 4 times'));
    assert.ok(JSON.stringify(requests.at(-1).messages).includes('Tool call limit exceeded.'));
    assert.ok(!('tool_choice' in requests.at(-1)), 'limit finalization must not send tool_choice');
    assert.ok(toolEvents.some((event) => event.summary?.reason === 'run-limit'));
    assert.equal(finishes[0].status, 'completed');
    assert.equal(finishes[0].metadata.retrievalLimited, true);
    assert.equal(finishes[0].metadata.blockedRetrievalCalls, 1);
  });

  it('executes only four calls when the model requests five searches in parallel', async () => {
    const finalAnswer = JSON.stringify({
      answer: '已有证据支持答案为 A。[1]',
      grounded: true,
      citedChunkIds: [chunkId],
    });
    const { answers, requests, getSearchCalls, getEmbeddingCalls } = createHarness({
      enableThinking: false,
      scriptedResponses: [
        chatCompletion({
          toolCalls: [1, 2, 3, 4, 5].map((number) => searchToolCall(`call_${number}`)),
        }),
        chatCompletion({ content: finalAnswer }),
      ],
    });

    const result = await answers.answer({
      knowledgeBaseId: kbId,
      request: { question: '答案是什么？' },
    });

    assert.equal(getSearchCalls(), 4);
    assert.equal(getEmbeddingCalls(), 4);
    assert.equal(requests.length, 2);
    assert.equal(result.grounded, true);
    assert.match(result.answer, new RegExp(`${retrievalLimitNotice}$`));
  });

  it('keeps citation correction after retrieval-limit finalization', async () => {
    const unknownId = '99999999-9999-4999-8999-999999999999';
    const { answers, requests, getSearchCalls } = createHarness({
      enableThinking: false,
      scriptedResponses: [
        chatCompletion({ toolCalls: [searchToolCall('call_1')] }),
        chatCompletion({ toolCalls: [searchToolCall('call_2')] }),
        chatCompletion({ toolCalls: [searchToolCall('call_3')] }),
        chatCompletion({ toolCalls: [searchToolCall('call_4')] }),
        chatCompletion({ toolCalls: [searchToolCall('call_5')] }),
        chatCompletion({
          content: JSON.stringify({
            answer: '已有证据支持答案为 A。[1]',
            grounded: true,
            citedChunkIds: [unknownId],
          }),
        }),
        chatCompletion({
          content: JSON.stringify({
            answer: '已有证据支持答案为 A。[1]',
            grounded: true,
            citedChunkIds: [chunkId],
          }),
        }),
      ],
    });

    const result = await answers.answer({
      knowledgeBaseId: kbId,
      request: { question: '答案是什么？' },
    });

    assert.equal(getSearchCalls(), 4);
    assert.equal(result.grounded, true);
    assert.equal(result.citations[0].chunkId, chunkId);
    assert.match(result.answer, new RegExp(`${retrievalLimitNotice}$`));
    assert.deepEqual(requests.at(-1).response_format, { type: 'json_object' });
    assert.ok(!('tool_choice' in requests.at(-1)), 'correction must not send tool_choice');
  });

  it('records model, context, and raw output diagnostics through the narrow recorder seam', async () => {
    const recorded = { models: [], contexts: [], outputs: [], finishes: [] };
    const reporter = {
      start: () => ({
        recordMetadata: () => undefined,
        recordStep: () => undefined,
        recordModelCall: (value) => recorded.models.push(value),
        recordToolCall: () => undefined,
        recordContext: (value) => recorded.contexts.push(value),
        recordReasoning: () => undefined,
        recordOutput: (value) => recorded.outputs.push(value),
        finish: async (value) => recorded.finishes.push(value),
      }),
    };
    const { answers } = createHarness({
      enableThinking: false,
      finalAnswer: JSON.stringify({
        answer: '依据显示答案为 A。[1]',
        grounded: true,
        citedChunkIds: [chunkId],
      }),
      reporter,
    });

    await answers.answer({ knowledgeBaseId: kbId, request: { question: '答案是什么？' } });

    assert.deepEqual(
      recorded.models.map((event) => event.name),
      ['knowledge-answer-generation', 'query-embedding', 'knowledge-answer-generation'],
    );
    const modelRounds = recorded.models.filter(
      (event) => event.name === 'knowledge-answer-generation',
    );
    assert.deepEqual(
      modelRounds[0].input.messages.slice(0, 2).map((message) => message.role),
      ['system', 'user'],
    );
    assert.match(modelRounds[0].input.messages[1].content, /答案是什么/);
    assert.equal(modelRounds[0].output.role, 'assistant');
    assert.ok(modelRounds[1].input.messages.some((message) => message.role === 'tool'));
    assert.ok(recorded.contexts.some((value) => value.systemPrompt?.includes('search_knowledge')));
    assert.ok(recorded.outputs.some((value) => value.rawText?.includes('citedChunkIds')));
    assert.equal(recorded.finishes[0].status, 'completed');
  });

  it('answers grounded questions without sending tool_choice and with thinking disabled by default', async () => {
    const { answers, requests } = createHarness({
      enableThinking: false,
      finalAnswer: JSON.stringify({
        answer: '依据显示答案为 A。[1]',
        grounded: true,
        citedChunkIds: [chunkId],
      }),
    });

    const result = await answers.answer({
      knowledgeBaseId: kbId,
      request: { question: '答案是什么？' },
    });

    assert.equal(result.answer, '依据显示答案为 A。[1]');
    assert.equal(result.grounded, true);
    assert.equal(result.citations[0].chunkId, chunkId);
    // Regression: thinking mode rejects tool_choice, so no request may carry it.
    assert.ok(requests.length >= 2);
    for (const body of requests) {
      assert.ok(!('tool_choice' in body), 'request must not send tool_choice');
    }
    // The retrieval tool is bound; the structured-output schema tool is gone.
    const toolNames = requests[0].tools.map((tool) => tool.function.name);
    assert.ok(toolNames.includes('search_knowledge'));
    assert.ok(
      !toolNames.some((name) => name.startsWith('extract-')),
      'structured-output schema tool must not be bound',
    );
    assert.deepEqual(requests[0].thinking, { type: 'disabled' });
  });

  it('keeps every valid citation when the model cites more than eight chunks', async () => {
    const chunks = Array.from({ length: 9 }, (_, index) => {
      const number = index + 1;
      return {
        id: `33333333-3333-4333-8333-${String(number).padStart(12, '0')}`,
        documentId: '44444444-4444-4444-8444-444444444444',
        documentTitle: `研究 ${number}.md`,
        locator: { kind: 'markdown', headingPath: ['结论'], lineStart: number, lineEnd: number },
        content: `第 ${number} 条核心依据。`,
      };
    });
    const allIds = chunks.map((chunk) => chunk.id);
    const { answers, requests } = createHarness({
      enableThinking: false,
      finalAnswer: JSON.stringify({
        answer: '知识库包含九类核心内容。[1][2][3][4][5][6][7][8][9]',
        grounded: true,
        citedChunkIds: allIds,
      }),
      searchChunks: chunks,
    });

    const result = await answers.answer({
      knowledgeBaseId: kbId,
      request: { question: '核心内容是什么？' },
    });

    assert.equal(result.grounded, true);
    // 合法引用不得被裁剪，否则正文里的 [9] 会失去对应来源。
    assert.equal(result.citations.length, 9);
    assert.equal(result.answer, '知识库包含九类核心内容。[1][2][3][4][5][6][7][8][9]');
    assert.deepEqual(
      answerCitationNumbers(result.answer),
      Array.from({ length: 9 }, (_, index) => index + 1),
    );
    assert.deepEqual(
      result.citations.map((citation) => citation.number),
      Array.from({ length: 9 }, (_, index) => index + 1),
    );
    assert.doesNotMatch(result.answer, /没有足够依据/);
    // 全部引用都在白名单内时不应再触发纠正调用。
    assert.equal(requests.length, 2);
    assert.ok(JSON.stringify(requests[0].messages).includes('no more than 24 citedChunkIds'));
  });

  it('preserves verified citations when the model exceeds the prompt guidance', async () => {
    const chunks = Array.from({ length: 9 }, (_, index) => {
      const number = index + 1;
      return {
        id: `77777777-7777-4777-8777-${String(number).padStart(12, '0')}`,
        documentId: '44444444-4444-4444-8444-444444444444',
        documentTitle: `来源 ${number}.md`,
        locator: { kind: 'markdown', headingPath: ['摘要'], lineStart: number, lineEnd: number },
        content: `第 ${number} 条可信内容。`,
      };
    });
    const citedChunkIds = chunks.map((chunk) => chunk.id);
    const overLimitAnswer = JSON.stringify({
      answer: '九条来源共同支持这份知识库摘要。[1][2][3][4][5][6][7][8][9]',
      grounded: true,
      citedChunkIds,
    });
    const { answers } = createHarness({
      enableThinking: false,
      finalAnswer: overLimitAnswer,
      correctionAnswer: overLimitAnswer,
      searchChunks: chunks,
    });

    const result = await answers.answer({
      knowledgeBaseId: kbId,
      request: { question: '总结全部内容' },
    });

    assert.equal(result.grounded, true);
    assert.equal(result.citations.length, 9);
    assert.doesNotMatch(result.answer, /没有足够依据/);
  });

  it('keeps the complete citation list when the answer references only part of it', async () => {
    const chunks = Array.from({ length: 9 }, (_, index) => {
      const number = index + 1;
      return {
        id: `55555555-5555-4555-8555-${String(number).padStart(12, '0')}`,
        documentId: '44444444-4444-4444-8444-444444444444',
        documentTitle: `制度 ${number}.md`,
        locator: { kind: 'markdown', headingPath: ['规则'], lineStart: number, lineEnd: number },
        content: `第 ${number} 条业务规则。`,
      };
    });
    const { answers, requests } = createHarness({
      enableThinking: false,
      // 正文只用了 [1]..[8]，模型却回传了九个 ID。
      finalAnswer: JSON.stringify({
        answer: '八类规则覆盖了销售全流程。[1][2][3][4][5][6][7][8]',
        grounded: true,
        citedChunkIds: chunks.map((chunk) => chunk.id),
      }),
      searchChunks: chunks,
    });

    const result = await answers.answer({
      knowledgeBaseId: kbId,
      request: { question: '销售有哪些业务规则？' },
    });

    assert.equal(result.grounded, true);
    // 全部 ID 都合法，因此不触发纠正调用；正文未提及的合法来源仍保留在完整清单末尾。
    assert.equal(requests.length, 2);
    assert.equal(result.citations.length, 9);
    assert.deepEqual(
      result.citations.map((citation) => citation.chunkId),
      chunks.map((chunk) => chunk.id),
    );
    assert.deepEqual(
      answerCitationNumbers(result.answer),
      Array.from({ length: 8 }, (_, index) => index + 1),
    );
    assert.deepEqual(
      result.citations.map((citation) => citation.number),
      Array.from({ length: 9 }, (_, index) => index + 1),
    );
  });

  it('keeps every answer marker pointing at a returned citation source', async () => {
    const chunks = Array.from({ length: 9 }, (_, index) => {
      const number = index + 1;
      return {
        id: `66666666-6666-4666-8666-${String(number).padStart(12, '0')}`,
        documentId: '44444444-4444-4444-8444-444444444444',
        documentTitle: `制度 ${number}.md`,
        locator: { kind: 'markdown', headingPath: ['规则'], lineStart: number, lineEnd: number },
        content: `第 ${number} 条业务规则。`,
      };
    });
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
    const unknownId = '99999999-9999-4999-8999-999999999999';
    const { answers } = createHarness({
      enableThinking: false,
      // 第九个 ID 越权，纠正后只剩八个合法 ID，正文却仍有九个标记。
      finalAnswer: JSON.stringify({
        answer: '九类规则覆盖了销售全流程。[1][2][3][4][5][6][7][8][9]',
        grounded: true,
        citedChunkIds: [...chunks.slice(0, 8).map((chunk) => chunk.id), unknownId],
      }),
      correctionAnswer: JSON.stringify({
        answer: '八类规则覆盖了销售全流程。[1][2][3][4][5][6][7][8][9]',
        grounded: true,
        citedChunkIds: chunks.slice(0, 8).map((chunk) => chunk.id),
      }),
      reporter,
      searchChunks: chunks,
    });

    const result = await answers.answer({
      knowledgeBaseId: kbId,
      request: { question: '销售有哪些业务规则？' },
    });

    assert.equal(result.grounded, true);
    assert.equal(result.citations.length, 8);
    // 越界标记必须被移除，其余标记与来源编号保持一一对应。
    assert.ok(!result.answer.includes('[9]'));
    assert.deepEqual(
      answerCitationNumbers(result.answer),
      Array.from({ length: 8 }, (_, index) => index + 1),
    );
    assert.deepEqual(
      result.citations.map((citation) => citation.number),
      Array.from({ length: 8 }, (_, index) => index + 1),
    );
    const validation = steps.find((step) => step.name === 'citation-validation');
    assert.equal(validation.metadata.droppedMarkerCount, 1);
  });

  it('sends thinking enabled when DEEPSEEK_ENABLE_THINKING is true', async () => {
    const { answers, requests } = createHarness({
      enableThinking: true,
      finalAnswer: JSON.stringify({
        answer: '依据显示答案为 A。[1]',
        grounded: true,
        citedChunkIds: [chunkId],
      }),
    });

    const result = await answers.answer({
      knowledgeBaseId: kbId,
      request: { question: '答案是什么？' },
    });

    assert.equal(result.grounded, true);
    assert.deepEqual(requests[0].thinking, { type: 'enabled' });
    for (const body of requests) {
      assert.ok(!('tool_choice' in body), 'request must not send tool_choice');
    }
  });

  it('corrects invalid citation IDs through JSON-mode output without tool_choice', async () => {
    const unknownId = '99999999-9999-4999-8999-999999999999';
    const { answers, requests } = createHarness({
      enableThinking: false,
      finalAnswer: JSON.stringify({
        answer: '依据显示答案为 A。[1]',
        grounded: true,
        citedChunkIds: [unknownId],
      }),
      correctionAnswer: JSON.stringify({
        answer: '依据显示答案为 A。[1]',
        grounded: true,
        citedChunkIds: [chunkId],
      }),
    });

    const result = await answers.answer({
      knowledgeBaseId: kbId,
      request: { question: '答案是什么？' },
    });

    assert.equal(result.citations[0].chunkId, chunkId);
    const correctionRequest = requests.at(-1);
    assert.deepEqual(correctionRequest.response_format, { type: 'json_object' });
    assert.ok(
      !('tool_choice' in correctionRequest),
      'correction request must not send tool_choice',
    );
  });

  it('recovers malformed JSON with unescaped heading quotes without discarding grounded evidence', async () => {
    const modelEvents = [];
    const contexts = [];
    const reporter = {
      start: () => ({
        recordMetadata: () => undefined,
        recordStep: () => undefined,
        recordModelCall: (value) => modelEvents.push(value),
        recordToolCall: () => undefined,
        recordContext: (value) => contexts.push(value),
        recordReasoning: () => undefined,
        recordOutput: () => undefined,
        finish: async () => undefined,
      }),
    };
    const { answers, requests } = createHarness({
      enableThinking: false,
      finalAnswer: `{"answer":"文档包含"三、补充问题"章节。[1]","grounded":true,"citedChunkIds":["${chunkId}"]}`,
      correctionAnswer: JSON.stringify({
        answer: '文档包含“三、补充问题”章节。[1]',
        grounded: true,
        citedChunkIds: [chunkId],
      }),
      reporter,
    });

    const result = await answers.answer({
      knowledgeBaseId: kbId,
      request: { question: '补充问题有哪些？' },
    });

    assert.equal(result.grounded, true);
    assert.equal(result.answer, '文档包含“三、补充问题”章节。[1]');
    assert.equal(result.citations[0].chunkId, chunkId);
    assert.ok(modelEvents.some((event) => event.name === 'structured-output-recovery'));
    assert.ok(contexts.some((value) => value.reason === 'invalid-structured-output'));
    assert.deepEqual(requests.at(-1).response_format, { type: 'json_object' });
    assert.ok(!('tool_choice' in requests.at(-1)), 'structured recovery must not send tool_choice');
  });

  it('falls back to an insufficient-evidence answer when the agent output is not valid JSON', async () => {
    const { answers } = createHarness({
      enableThinking: false,
      finalAnswer: 'Sorry, I could not find enough evidence.',
    });

    const result = await answers.answer({
      knowledgeBaseId: kbId,
      request: { question: '答案是什么？' },
    });

    assert.equal(result.grounded, false);
    assert.equal(result.answer, '知识库中没有足够依据回答这个问题。');
    assert.deepEqual(result.citations, []);
  });
});
