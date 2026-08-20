import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';

import { createAiExecutionReporter } from '../../dist/ai-observability/executionReporter.js';

const safeConfig = {
  enabled: true,
  outputDirectory: '.ai-execution-reports',
  includeContext: false,
  includeToolContent: false,
  includeOutput: false,
  includeReasoning: false,
};

describe('AI execution reporter', () => {
  it('performs no work while disabled', async () => {
    const reporter = createAiExecutionReporter(
      { ...safeConfig, enabled: false },
      {
        now: () => {
          throw new Error('disabled reporter must not read the clock');
        },
        createId: () => {
          throw new Error('disabled reporter must not allocate an ID');
        },
        writeReport: async () => {
          throw new Error('disabled reporter must not write');
        },
      },
    );

    const run = reporter.start({ kind: 'rag-answer', name: 'disabled' });
    run.recordContext({ shouldNotSerialize: 1n });
    run.recordStep({ name: 'ignored', status: 'completed' });
    await run.finish({ status: 'completed' });
  });

  it('writes safe metadata while excluding protected content', async () => {
    const writes = [];
    const reporter = createAiExecutionReporter(safeConfig, {
      repositoryRoot: 'C:\\workspace',
      now: () => new Date('2026-08-20T01:02:03.000Z'),
      createId: () => 'run-1',
      writeReport: async (filePath, content) => writes.push({ filePath, content }),
    });
    const run = reporter.start({
      kind: 'rag-answer',
      name: 'knowledge answer',
      metadata: { apiKey: 'top-secret', inputTokens: 12 },
    });
    run.recordToolCall({
      name: 'search_knowledge',
      status: 'completed',
      summary: { hitCount: 2 },
      input: { query: 'private question' },
      output: { content: 'private source' },
    });
    run.recordContext({ prompt: 'private prompt' });
    run.recordReasoning('private reasoning');
    run.recordOutput('private output');
    await run.finish({ status: 'completed' });

    assert.equal(writes.length, 1);
    assert.match(writes[0].filePath, /\.ai-execution-reports[\\/]2026-08-20[\\/].*rag-answer-run-1\.md$/);
    assert.match(writes[0].content, /"apiKey": "\[REDACTED\]"/);
    assert.match(writes[0].content, /"inputTokens": 12/);
    assert.match(writes[0].content, /"hitCount": 2/);
    assert.doesNotMatch(writes[0].content, /private question|private source|private prompt|private reasoning|private output/);
    assert.doesNotMatch(writes[0].content, /## Context|## Reasoning|## Output/);
  });

  it('safely serializes opt-in sections, truncates them, and finishes once', async () => {
    const writes = [];
    const shared = { value: 2n };
    const circular = { shared };
    circular.self = circular;
    const reporter = createAiExecutionReporter(
      {
        ...safeConfig,
        includeContext: true,
        includeToolContent: true,
        includeOutput: true,
        includeReasoning: true,
      },
      {
        now: () => new Date('2026-08-20T01:02:03.000Z'),
        createId: () => 'run-2',
        writeReport: async (filePath, content) => writes.push({ filePath, content }),
      },
    );
    const run = reporter.start({ kind: 'future-workflow', name: 'future' });
    run.recordContext({ left: shared, right: shared, circular });
    run.recordReasoning('contains ``` a nested fence');
    run.recordOutput('x'.repeat(120_100));
    await run.finish({ status: 'failed', error: Object.assign(new Error('failed'), { code: 'MODEL_ERROR' }) });
    await run.finish({ status: 'completed' });

    assert.equal(writes.length, 1);
    assert.match(writes[0].content, /## Context/);
    assert.match(writes[0].content, /"value": "2n"/);
    assert.match(writes[0].content, /"self": "\[Circular\]"/);
    assert.match(writes[0].content, /## Reasoning/);
    assert.match(writes[0].content, /\.\.\. \[truncated\]/);
    assert.match(writes[0].content, /"code": "MODEL_ERROR"/);
  });

  it('uses unique names for concurrent reports and honors an absolute output directory', async () => {
    const writes = [];
    const ids = ['first', 'second'];
    const outputDirectory = path.resolve('custom-ai-reports');
    const reporter = createAiExecutionReporter(
      { ...safeConfig, outputDirectory },
      {
        now: () => new Date('2026-08-20T01:02:03.000Z'),
        createId: () => ids.shift(),
        writeReport: async (filePath, content) => writes.push({ filePath, content }),
      },
    );

    await Promise.all([
      reporter.start({ kind: 'rag-answer', name: 'first' }).finish({ status: 'completed' }),
      reporter.start({ kind: 'rag-answer', name: 'second' }).finish({ status: 'completed' }),
    ]);

    assert.equal(writes.length, 2);
    assert.equal(new Set(writes.map((entry) => entry.filePath)).size, 2);
    assert.ok(writes.every((entry) => entry.filePath.startsWith(outputDirectory)));
  });

  it('isolates writer failures', async () => {
    const warnings = [];
    const reporter = createAiExecutionReporter(safeConfig, {
      now: () => new Date('2026-08-20T01:02:03.000Z'),
      createId: () => 'failed-write',
      writeReport: async () => {
        throw new Error('disk unavailable');
      },
      warn: (message) => warnings.push(message),
    });

    await reporter.start({ kind: 'rag-answer', name: 'failed write' }).finish({ status: 'completed' });

    assert.deepEqual(warnings, ['[ai-execution-report] failed to write execution report']);
  });
});
