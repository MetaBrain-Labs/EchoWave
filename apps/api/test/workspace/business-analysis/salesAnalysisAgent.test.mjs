/**
 * 销售复盘 Agent 契约测试。
 *
 * 验证模型输出的本地化恢复和销售分析专用思考模式，避免供应商表达差异导致任务整体失败。
 *
 * Responsibilities:
 * - 验证中文核心章节标题会规范化为内部英文代码。
 * - 验证销售分析请求始终显式开启思考模式。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  parseSalesAnalysisResult,
  SalesAnalysisAgent,
} from '../../../dist/workspace/business-analysis/salesAnalysisAgent.js';

const segmentId = '11111111-1111-4111-8111-111111111111';

function analysisJob() {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    audioFileId: '33333333-3333-4333-8333-333333333333',
    groupId: '44444444-4444-4444-8444-444444444444',
    revisionId: '55555555-5555-4555-8555-555555555555',
    confirmationId: '66666666-6666-4666-8666-666666666666',
    confirmationVersion: 1,
    model: 'deepseek-v4-flash',
    knowledgeBaseIds: [],
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
        text: '请问您当前最关注什么？',
        role: null,
        emotion: null,
      },
    ],
  };
}

function validResult() {
  return {
    limitations: [],
    summarySections: [
      { title: '总体总结', body: '整体表现稳定。' },
      { title: '话术优点', body: '能够确认客户需求。' },
      { title: '待改进点', body: '价值表达可以更具体。' },
      { title: '风险提示', body: '没有发现未经证实的承诺。' },
      { title: '行动建议', body: '下一步补充量化案例。' },
    ],
    tags: [
      {
        category: 'strength',
        customLabel: null,
        title: '需求确认',
        summary: '销售先确认了客户需求。',
        details: [],
        confidence: 90,
        evidenceSegmentIds: [segmentId],
        citedChunkIds: [],
      },
    ],
  };
}

function chatCompletion(content) {
  return {
    id: 'chatcmpl-sales-test',
    object: 'chat.completion',
    created: 1,
    model: 'deepseek-v4-flash',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
  };
}

function recorder(modelCalls) {
  return {
    recordMetadata: () => {},
    recordStep: () => {},
    recordModelCall: (event) => modelCalls.push(event),
    recordToolCall: () => {},
    recordContext: () => {},
    recordReasoning: () => {},
    recordOutput: () => {},
    finish: async () => {},
  };
}

describe('SalesAnalysisAgent', () => {
  it('normalizes localized core section titles before strict validation', () => {
    const parsed = parseSalesAnalysisResult(validResult());

    assert.equal(parsed.success, true);
    assert.deepEqual(
      parsed.data.summarySections.map((section) => section.title),
      ['overall', 'strengths', 'improvements', 'risks', 'actions'],
    );
  });

  it('enables thinking for sales analysis even when the shared setting is disabled', async () => {
    const requests = [];
    const modelCalls = [];
    const agent = new SalesAnalysisAgent({
      ragConfig: {
        deepSeekApiKey: 'test-key',
        deepSeekBaseUrl: 'https://deepseek.example.com/v1',
        deepSeekChatModel: 'deepseek-v4-flash',
        enableThinking: false,
      },
      fetchImplementation: async (_url, init) => {
        requests.push(JSON.parse(init.body));
        return Response.json(chatCompletion('{"queries":["客户需求"]}'));
      },
    });

    const queries = await agent.planRetrievalQueries(analysisJob(), recorder(modelCalls));

    assert.deepEqual(queries, ['客户需求']);
    assert.deepEqual(requests[0].thinking, { type: 'enabled' });
    assert.equal(modelCalls.length, 1);
    assert.deepEqual(
      modelCalls[0].input.messages.map(({ role }) => role),
      ['system', 'user'],
    );
    assert.match(modelCalls[0].input.messages[1].content, /analysisFocus/);
    assert.match(modelCalls[0].output.content, /queries/);
  });

  it('records both invalid structure attempts with their actual prompts and outputs', async () => {
    const modelCalls = [];
    const agent = new SalesAnalysisAgent({
      ragConfig: {
        deepSeekApiKey: 'test-key',
        deepSeekBaseUrl: 'https://deepseek.example.com/v1',
        deepSeekChatModel: 'deepseek-v4-flash',
        enableThinking: false,
      },
      fetchImplementation: async () => Response.json(chatCompletion('{"summarySections":[]}')),
    });

    await assert.rejects(
      () =>
        agent.analyze({
          job: analysisJob(),
          preRetrieved: [],
          searchKnowledge: async () => [],
          recorder: recorder(modelCalls),
        }),
      (error) => error.code === 'INVALID_MODEL_OUTPUT',
    );

    assert.equal(modelCalls.length, 2);
    assert.deepEqual(
      modelCalls.map(({ attempt }) => attempt),
      [1, 2],
    );
    assert.ok(
      modelCalls.every(
        (event) =>
          event.input.messages[0].role === 'system' &&
          event.input.messages.some((message) => message.role === 'user') &&
          event.output.content.includes('summarySections'),
      ),
    );
    assert.equal(
      modelCalls[1].input.messages.filter((message) => message.role === 'user').length,
      2,
    );
  });
});
