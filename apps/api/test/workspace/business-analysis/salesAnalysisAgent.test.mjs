/**
 * 销售复盘 Agent 契约测试。
 *
 * 验证模型输出的本地化恢复和销售分析专用思考模式，避免供应商表达差异导致任务整体失败。
 *
 * Responsibilities:
 * - 验证中文核心章节标题会规范化为内部英文代码。
 * - 验证标签数量归一化、销售分析思考模式和截断后的结构修复。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  parseSalesAnalysisResult,
  SalesAnalysisAgent,
} from '../../../dist/workspace/audio/business-analysis/salesAnalysisAgent.js';
import {
  salesAnalysisContext,
  salesAnalysisRepairContext,
} from '../../../dist/workspace/audio/business-analysis/CONTEXT.js';

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
      language: 'zh-CN',
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
        confidence: 0.9,
        evidenceSegmentIds: [segmentId],
        citedChunkIds: [],
      },
    ],
  };
}

function analysisTag(category, index) {
  return {
    category,
    customLabel: category === 'custom' ? '自定义关注' : null,
    title: `${category}-${index}`,
    summary: `${category} 摘要 ${index}`,
    details: [],
    confidence: 90,
    evidenceSegmentIds: [segmentId],
    citedChunkIds: [],
  };
}

function resultWithCategoryCounts(counts) {
  return {
    ...validResult(),
    tags: Object.entries(counts).flatMap(([category, count]) =>
      Array.from({ length: count }, (_, index) => analysisTag(category, index + 1)),
    ),
  };
}

function chatCompletion(
  content,
  { finishReason = 'stop', completionTokens = 10, reasoningContent = '分析当前任务。' } = {},
) {
  return {
    id: 'chatcmpl-sales-test',
    object: 'chat.completion',
    created: 1,
    model: 'deepseek-v4-flash',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content, reasoning_content: reasoningContent },
        finish_reason: finishReason,
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: completionTokens,
      total_tokens: 10 + completionTokens,
    },
  };
}

function responseForChatCompletion(completion, request) {
  if (!request.stream) return Response.json(completion);
  const choice = completion.choices[0];
  const base = {
    id: completion.id,
    object: 'chat.completion.chunk',
    created: completion.created,
    model: completion.model,
  };
  const events = [
    {
      ...base,
      choices: [
        {
          index: 0,
          delta: {
            role: 'assistant',
            reasoning_content: choice.message.reasoning_content,
          },
          finish_reason: null,
        },
      ],
    },
    {
      ...base,
      choices: [{ index: 0, delta: { content: choice.message.content }, finish_reason: null }],
    },
    {
      ...base,
      choices: [{ index: 0, delta: {}, finish_reason: choice.finish_reason }],
      usage: completion.usage,
    },
  ];
  return new Response(
    `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`,
    {
      headers: { 'Content-Type': 'text/event-stream' },
    },
  );
}

function recorder(modelCalls, steps = []) {
  return {
    recordMetadata: () => {},
    recordStep: (event) => steps.push(event),
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
    assert.equal(parsed.data.tags[0].confidence, 90);
  });

  it('uses the public eight-item limitations cap in validation and repair prompts', () => {
    const accepted = parseSalesAnalysisResult({
      ...validResult(),
      limitations: Array.from({ length: 8 }, (_, index) => `限制 ${index + 1}`),
    });
    const rejected = parseSalesAnalysisResult({
      ...validResult(),
      limitations: Array.from({ length: 9 }, (_, index) => `限制 ${index + 1}`),
    });

    assert.equal(accepted.success, true);
    assert.equal(rejected.success, false);
    assert.match(salesAnalysisContext(12), /no more than 8 limitations/);
    assert.match(salesAnalysisRepairContext(12), /no more than 8 limitations/);
  });

  it('balances over-limit tags across categories while preserving selected source order', () => {
    const source = resultWithCategoryCounts({
      strength: 4,
      improvement: 4,
      risk: 3,
      suggestion: 3,
    });
    const parsed = parseSalesAnalysisResult(source);

    assert.equal(parsed.success, true);
    assert.equal(parsed.data.tags.length, 12);
    assert.deepEqual(
      Object.fromEntries(
        ['strength', 'improvement', 'risk', 'suggestion'].map((category) => [
          category,
          parsed.data.tags.filter((tag) => tag.category === category).length,
        ]),
      ),
      { strength: 3, improvement: 3, risk: 3, suggestion: 3 },
    );
    assert.deepEqual(
      parsed.data.tags.map((tag) => tag.title),
      source.tags.filter((tag) => !tag.title.endsWith('-4')).map((tag) => tag.title),
    );
  });

  it('shares extra slots across five categories and leaves invalid categories for strict validation', () => {
    const parsed = parseSalesAnalysisResult(
      resultWithCategoryCounts({
        strength: 3,
        improvement: 3,
        risk: 3,
        suggestion: 3,
        custom: 3,
      }),
    );
    assert.equal(parsed.success, true);
    assert.deepEqual(
      Object.fromEntries(
        ['strength', 'improvement', 'risk', 'suggestion', 'custom'].map((category) => [
          category,
          parsed.data.tags.filter((tag) => tag.category === category).length,
        ]),
      ),
      { strength: 3, improvement: 3, risk: 2, suggestion: 2, custom: 2 },
    );

    const invalid = resultWithCategoryCounts({ strength: 12 });
    invalid.tags.push(analysisTag('unknown', 1));
    const invalidParsed = parseSalesAnalysisResult(invalid);
    assert.equal(invalidParsed.success, false);
    assert.ok(invalidParsed.error.issues.some((issue) => issue.path.join('.') === 'tags'));
  });

  it('uses a short non-thinking budget for retrieval planning', async () => {
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
        const request = JSON.parse(init.body);
        requests.push(request);
        return responseForChatCompletion(chatCompletion('{"queries":["客户需求"]}'), request);
      },
    });

    const queries = await agent.planRetrievalQueries(analysisJob(), recorder(modelCalls));

    assert.deepEqual(queries, ['客户需求']);
    assert.deepEqual(requests[0].thinking, { type: 'disabled' });
    assert.equal(requests[0].max_tokens, 768);
    assert.equal(modelCalls.length, 1);
    assert.deepEqual(
      modelCalls[0].input.messages.map(({ role }) => role),
      ['system', 'user'],
    );
    assert.match(modelCalls[0].input.messages[1].content, /analysisFocus/);
    assert.match(modelCalls[0].output.content, /queries/);
  });

  it('records invalid analysis and repair calls with their actual prompts and outputs', async () => {
    const modelCalls = [];
    const agent = new SalesAnalysisAgent({
      ragConfig: {
        deepSeekApiKey: 'test-key',
        deepSeekBaseUrl: 'https://deepseek.example.com/v1',
        deepSeekChatModel: 'deepseek-v4-flash',
        enableThinking: false,
      },
      fetchImplementation: async (_url, init) =>
        responseForChatCompletion(chatCompletion('{"summarySections":[]}'), JSON.parse(init.body)),
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
      modelCalls.map(({ name }) => name),
      ['business-analysis-generation', 'business-analysis-structure-repair'],
    );
    assert.deepEqual(
      modelCalls.map(({ attempt }) => attempt),
      [1, 1],
    );
    assert.ok(
      modelCalls.every(
        (event) =>
          event.status === 'completed' &&
          event.durationMs >= 0 &&
          JSON.stringify(event.output).includes('summarySections'),
      ),
    );
    assert.equal(modelCalls[0].input.kind, 'agent-chat');
    assert.deepEqual(
      modelCalls[1].input.messages.map(({ role }) => role),
      ['system', 'user'],
    );
  });

  it('repairs a token-truncated response and balances an over-limit repair result', async () => {
    const requests = [];
    const modelCalls = [];
    const steps = [];
    const agent = new SalesAnalysisAgent({
      ragConfig: {
        deepSeekApiKey: 'test-key',
        deepSeekBaseUrl: 'https://deepseek.example.com/v1',
        deepSeekChatModel: 'deepseek-v4-flash',
        enableThinking: false,
      },
      fetchImplementation: async (_url, init) => {
        const request = JSON.parse(init.body);
        requests.push(request);
        const completion =
          requests.length === 1
            ? chatCompletion('{"summarySections":[{"title":"overall"', {
                finishReason: 'length',
                completionTokens: 7_998,
              })
            : chatCompletion(
                JSON.stringify(
                  resultWithCategoryCounts({
                    strength: 4,
                    improvement: 4,
                    risk: 3,
                    suggestion: 3,
                  }),
                ),
              );
        return responseForChatCompletion(completion, request);
      },
    });

    const result = await agent.analyze({
      job: analysisJob(),
      preRetrieved: [],
      searchKnowledge: async () => [],
      recorder: recorder(modelCalls, steps),
    });

    assert.equal(result.tags.length, 12);
    assert.deepEqual(requests[0].thinking, { type: 'disabled' });
    assert.equal(requests[0].max_tokens, 6_000);
    assert.deepEqual(requests[1].thinking, { type: 'disabled' });
    assert.equal(requests[1].max_tokens, 4_096);
    assert.deepEqual(
      modelCalls.map(({ name }) => name),
      ['business-analysis-generation', 'business-analysis-structure-repair'],
    );
    assert.equal(modelCalls[0].status, 'completed');
    assert.ok(
      steps.some(
        (step) =>
          step.name === 'business-analysis-structure-validation' &&
          step.metadata.outputTruncated === true,
      ),
    );
    assert.ok(
      steps.some(
        (step) =>
          step.name === 'business-analysis-structure-repair' &&
          step.status === 'completed' &&
          step.metadata.tagLimitNormalization.originalCount === 14 &&
          step.metadata.tagLimitNormalization.keptCount === 12 &&
          step.metadata.tagLimitNormalization.keptByCategory.strength === 3 &&
          step.metadata.tagLimitNormalization.keptByCategory.improvement === 3 &&
          step.metadata.tagLimitNormalization.keptByCategory.risk === 3 &&
          step.metadata.tagLimitNormalization.keptByCategory.suggestion === 3,
      ),
    );
    assert.equal(requests.length, 2);
  });

  it('marks malformed near-limit output as truncated when the provider omits finish reason', async () => {
    const requests = [];
    const steps = [];
    const agent = new SalesAnalysisAgent({
      ragConfig: {
        deepSeekApiKey: 'test-key',
        deepSeekBaseUrl: 'https://deepseek.example.com/v1',
        deepSeekChatModel: 'deepseek-v4-flash',
        enableThinking: false,
      },
      fetchImplementation: async (_url, init) => {
        const request = JSON.parse(init.body);
        requests.push(request);
        const completion =
          requests.length === 1
            ? chatCompletion('{"summarySections":[{"title":"overall"', {
                finishReason: null,
                completionTokens: 7_998,
              })
            : chatCompletion(JSON.stringify(validResult()));
        return responseForChatCompletion(completion, request);
      },
    });

    await agent.analyze({
      job: analysisJob(),
      preRetrieved: [],
      searchKnowledge: async () => [],
      recorder: recorder([], steps),
    });

    const validation = steps.find((step) => step.name === 'business-analysis-structure-validation');
    assert.equal(validation.metadata.finishReason, null);
    assert.equal(validation.metadata.outputTokens, 7_998);
    assert.equal(validation.metadata.maxOutputTokens, 6_000);
    assert.equal(validation.metadata.outputTruncated, true);
  });
});
