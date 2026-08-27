import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { IngestionWorker } from '../../../dist/knowledge/ingestion/worker.js';

function createReporter() {
  const records = [];
  return {
    records,
    reporter: {
      start: (input) => {
        const record = {
          input,
          metadata: [],
          steps: [],
          models: [],
          contexts: [],
          outputs: [],
          finishes: [],
        };
        records.push(record);
        return {
          recordMetadata: (value) => record.metadata.push(value),
          recordStep: (value) => record.steps.push(value),
          recordModelCall: (value) => record.models.push(value),
          recordToolCall: () => undefined,
          recordContext: (value) => record.contexts.push(value),
          recordReasoning: () => undefined,
          recordOutput: (value) => record.outputs.push(value),
          finish: async (value) => record.finishes.push(value),
        };
      },
    },
  };
}

function createJob(stagedPath, sizeBytes, attempts = 1) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    tenantId: '22222222-2222-4222-8222-222222222222',
    knowledgeBaseId: '33333333-3333-4333-8333-333333333333',
    documentId: '44444444-4444-4444-8444-444444444444',
    revisionId: '55555555-5555-4555-8555-555555555555',
    stagedPath,
    title: '测试.md',
    format: 'markdown',
    sizeBytes,
    attempts,
  };
}

describe('knowledge ingestion execution diagnostics', () => {
  it('records every successful graph stage and embedding usage', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'echowave-worker-'));
    const stagedPath = path.join(directory, 'source.md');
    const source = Buffer.from('# 结论\n\n答案为 A。', 'utf8');
    await writeFile(stagedPath, source);
    const { reporter, records } = createReporter();
    const repositoryEvents = [];
    const worker = new IngestionWorker({
      repository: {
        setJobStage: async (_job, stage) => repositoryEvents.push(stage),
        publishRevision: async (input) => repositoryEvents.push(`publish:${input.chunks.length}`),
        failJob: async () => repositoryEvents.push('failed'),
      },
      embeddings: {
        embedBatches: async (documents) => ({
          vectors: documents.map(() => Array(1024).fill(0.1)),
          tokens: 9,
          provider: 'test-provider',
          model: 'qwen3.7-text-embedding',
          estimatedCost: { amount: 0.0000045, currency: 'CNY' },
        }),
      },
      embeddingModel: 'qwen3.7-text-embedding',
      uploadTempDirectory: directory,
      reporter,
    });

    try {
      await worker.execute(createJob(stagedPath, source.byteLength));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }

    assert.equal(records[0].input.kind, 'knowledge-ingestion');
    assert.deepEqual(
      records[0].steps.filter((event) => event.status === 'completed').map((event) => event.name),
      ['validate', 'parse', 'normalize', 'chunk', 'embed', 'publish', 'cleanup'],
    );
    assert.equal(records[0].models[0].inputTokens, 9);
    assert.equal(records[0].models[0].metadata.vectorCount, 1);
    assert.equal(
      records[0].steps.find((event) => event.name === 'cleanup' && event.status === 'completed')
        .metadata.removed,
      true,
    );
    assert.equal(records[0].finishes[0].status, 'completed');
    assert.deepEqual(repositoryEvents, [
      'validate',
      'parse',
      'normalize',
      'chunk',
      'embed',
      'embed',
      'publish:1',
    ]);
  });

  it('records a retryable embedding failure after persisting the job failure', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'echowave-worker-'));
    const stagedPath = path.join(directory, 'source.md');
    const source = Buffer.from('# 结论\n\n答案为 A。', 'utf8');
    await writeFile(stagedPath, source);
    const { reporter, records } = createReporter();
    const failures = [];
    const worker = new IngestionWorker({
      repository: {
        setJobStage: async () => undefined,
        publishRevision: async () => undefined,
        failJob: async (_job, code, _message, retryable) => failures.push({ code, retryable }),
      },
      embeddings: {
        embedBatches: async () => {
          throw new Error('provider unavailable');
        },
      },
      embeddingModel: 'qwen3.7-text-embedding',
      uploadTempDirectory: directory,
      reporter,
    });
    const originalConsoleError = console.error;
    console.error = () => undefined;
    try {
      await worker.execute(createJob(stagedPath, source.byteLength, 1));
    } finally {
      console.error = originalConsoleError;
      await rm(directory, { recursive: true, force: true });
    }

    assert.deepEqual(failures, [{ code: 'INTERNAL_ERROR', retryable: true }]);
    assert.equal(records[0].models[0].status, 'failed');
    assert.ok(
      records[0].steps.some((event) => event.name === 'embed' && event.status === 'failed'),
    );
    assert.ok(
      records[0].steps.some(
        (event) => event.name === 'persist-failure' && event.status === 'completed',
      ),
    );
    assert.equal(records[0].finishes[0].status, 'failed');
    assert.equal(records[0].finishes[0].metadata.retryable, true);
  });

  it('records a non-retryable publish failure and removes its staged file', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'echowave-worker-'));
    const stagedPath = path.join(directory, 'source.md');
    const source = Buffer.from('# 结论\n\n答案为 A。', 'utf8');
    await writeFile(stagedPath, source);
    const { reporter, records } = createReporter();
    const failures = [];
    const worker = new IngestionWorker({
      repository: {
        setJobStage: async () => undefined,
        publishRevision: async () => {
          throw new Error('database unavailable');
        },
        failJob: async (_job, code, _message, retryable) => failures.push({ code, retryable }),
      },
      embeddings: {
        embedBatches: async (documents) => ({
          vectors: documents.map(() => Array(1024).fill(0.1)),
          tokens: 9,
          provider: 'test-provider',
          model: 'qwen3.7-text-embedding',
          estimatedCost: { amount: 0.0000045, currency: 'CNY' },
        }),
      },
      embeddingModel: 'qwen3.7-text-embedding',
      uploadTempDirectory: directory,
      reporter,
    });
    const originalConsoleError = console.error;
    console.error = () => undefined;
    try {
      await worker.execute(createJob(stagedPath, source.byteLength, 3));
      await assert.rejects(access(stagedPath));
    } finally {
      console.error = originalConsoleError;
      await rm(directory, { recursive: true, force: true });
    }

    assert.deepEqual(failures, [{ code: 'INTERNAL_ERROR', retryable: false }]);
    assert.ok(
      records[0].steps.some((event) => event.name === 'publish' && event.status === 'failed'),
    );
    assert.equal(records[0].finishes[0].status, 'failed');
    assert.equal(records[0].finishes[0].metadata.retryable, false);
  });
});
