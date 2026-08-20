import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MemorySaver } from '@langchain/langgraph';

import { createKnowledgeAnswerModule } from '../dist/rag/knowledgeAnswer.js';
import { DeepSeekQueryAgent } from '../dist/rag/queryAgent.js';
import { parseJsonObject } from '../dist/rag/structuredOutput.js';

const kbId = '11111111-1111-4111-8111-111111111111';
const conversationId = '22222222-2222-4222-8222-222222222222';
const chunkId = '33333333-3333-4333-8333-333333333333';

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

/**
 * Builds the trusted-answer module with stubbed persistence/embeddings and a fake
 * DeepSeek transport. The fake provider first answers with a search_knowledge
 * tool call, then with the given final answer; an optional correction answer
 * serves the citation-correction model call.
 */
function createHarness({ enableThinking, finalAnswer, correctionAnswer }) {
  const requests = [];
  const fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    const index = requests.length - 1;
    if (index === 0) {
      return Response.json(chatCompletion({
        toolCalls: [{
          id: 'call_1',
          type: 'function',
          function: { name: 'search_knowledge', arguments: JSON.stringify({ query: '测试问题' }) },
        }],
      }));
    }
    if (index === 1) return Response.json(chatCompletion({ content: finalAnswer }));
    return Response.json(chatCompletion({ content: correctionAnswer }));
  };

  const checkpointer = new MemorySaver();
  const repository = {
    getOrCreateConversation: async () => ({ id: conversationId, threadId: `thread-${conversationId}` }),
    beginRun: async () => 'run-1',
    search: async () => [{
      id: chunkId,
      documentId: '44444444-4444-4444-8444-444444444444',
      documentTitle: '研究.md',
      locator: { kind: 'markdown', headingPath: ['结论'], lineStart: 3, lineEnd: 4 },
      content: '答案为 A。',
    }],
    completeRun: async () => undefined,
    failRun: async () => undefined,
    listExpiredConversations: async () => [],
    deleteExpiredConversation: async () => undefined,
  };
  const embeddings = {
    embedQueryWithUsage: async () => ({ vectors: [Array(1024).fill(0.1)], tokens: 7 }),
  };
  const agent = new DeepSeekQueryAgent({
    ragConfig: {
      tenantId: '00000000-0000-4000-8000-000000000001',
      openRouterApiKey: 'openrouter-test-key',
      embeddingModel: 'qwen/qwen3-embedding-8b',
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
    repository,
    embeddings,
    agent,
    checkpointer,
    ragConfig: {
      embeddingModel: 'qwen/qwen3-embedding-8b',
      deepSeekChatModel: 'deepseek-v4-flash',
    },
    scheduleCleanup: () => () => undefined,
  });

  return { answers, requests };
}

describe('parseJsonObject', () => {
  it('parses a plain JSON object', () => {
    assert.deepEqual(parseJsonObject('{"answer":"A","grounded":true}'), { answer: 'A', grounded: true });
  });

  it('parses a fully fenced JSON block', () => {
    assert.deepEqual(parseJsonObject('```json\n{"answer":"B"}\n```'), { answer: 'B' });
  });

  it('parses JSON surrounded by prose and markdown fences', () => {
    const text = 'Here is the answer:\n```json\n{"answer":"C","grounded":false,"citedChunkIds":[]}\n```\nHope this helps.';
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
  it('answers grounded questions without sending tool_choice and with thinking disabled by default', async () => {
    const { answers, requests } = createHarness({
      enableThinking: false,
      finalAnswer: JSON.stringify({ answer: '依据显示答案为 A。[1]', grounded: true, citedChunkIds: [chunkId] }),
    });

    const result = await answers.answer({ knowledgeBaseId: kbId, request: { question: '答案是什么？' } });

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
    assert.ok(!toolNames.some((name) => name.startsWith('extract-')), 'structured-output schema tool must not be bound');
    assert.deepEqual(requests[0].thinking, { type: 'disabled' });
  });

  it('sends thinking enabled when DEEPSEEK_ENABLE_THINKING is true', async () => {
    const { answers, requests } = createHarness({
      enableThinking: true,
      finalAnswer: JSON.stringify({ answer: '依据显示答案为 A。[1]', grounded: true, citedChunkIds: [chunkId] }),
    });

    const result = await answers.answer({ knowledgeBaseId: kbId, request: { question: '答案是什么？' } });

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
      finalAnswer: JSON.stringify({ answer: '依据显示答案为 A。[1]', grounded: true, citedChunkIds: [unknownId] }),
      correctionAnswer: JSON.stringify({ answer: '依据显示答案为 A。[1]', grounded: true, citedChunkIds: [chunkId] }),
    });

    const result = await answers.answer({ knowledgeBaseId: kbId, request: { question: '答案是什么？' } });

    assert.equal(result.citations[0].chunkId, chunkId);
    const correctionRequest = requests.at(-1);
    assert.deepEqual(correctionRequest.response_format, { type: 'json_object' });
    assert.ok(!('tool_choice' in correctionRequest), 'correction request must not send tool_choice');
  });

  it('falls back to an insufficient-evidence answer when the agent output is not valid JSON', async () => {
    const { answers } = createHarness({
      enableThinking: false,
      finalAnswer: 'Sorry, I could not find enough evidence.',
    });

    const result = await answers.answer({ knowledgeBaseId: kbId, request: { question: '答案是什么？' } });

    assert.equal(result.grounded, false);
    assert.equal(result.answer, '知识库中没有足够依据回答这个问题。');
    assert.deepEqual(result.citations, []);
  });
});
