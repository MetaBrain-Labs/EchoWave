/**
 * 一键式音频分析编排 Worker 测试。
 *
 * 验证阶段引用幂等保存、可选阶段降级和明确额度错误硬阻塞。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AudioAutomationWorker } from '../../dist/workspace/audio/automation/worker.js';

const configuration = {
  groupName: '销售组',
  analysisTiming: 'automatic',
  contentFocus: '分析销售表现',
  tone: '专业',
  customTags: [],
  knowledgeBaseIds: [],
  capabilityBindings: {
    transcription: null,
    staging: null,
    emotion: null,
    role: null,
    businessAnalysis: null,
    knowledgeEmbedding: null,
  },
  models: { transcription: null, emotion: null, role: null, businessAnalysis: null },
};
const pipeline = {
  confirmation: 'system_raw_snapshot',
  includeEmotion: true,
  includeRole: true,
  includeBusinessAnalysis: true,
  transcriptPolicy: 'reuse_or_create',
};
const baseTask = {
  id: '10000000-0000-4000-8000-000000000001',
  batchId: '20000000-0000-4000-8000-000000000001',
  audioFileId: '30000000-0000-4000-8000-000000000001',
  groupId: '40000000-0000-4000-8000-000000000001',
  runtimeMode: 'object_storage',
  pipeline,
  configuration,
  emotionJobId: null,
  roleJobId: null,
  businessJobId: null,
  stageSources: {},
  warningCodes: [],
  cancelRequested: false,
};

describe('AudioAutomationWorker', () => {
  it('creates one ASR run and persists its revision reference', async () => {
    const updates = [];
    const worker = new AudioAutomationWorker({
      repository: {
        reusableRevision: async () => null,
        setStageReference: async (_id, update) => updates.push(update),
      },
      audio: {
        startAudioTranscription: async () => ({
          audioFileId: baseTask.audioFileId,
          revisionId: '50000000-0000-4000-8000-000000000001',
          status: 'queued',
        }),
      },
    });
    await worker.advance({ ...baseTask, phase: 'transcription', analysisRevisionId: null });
    assert.deepEqual(updates, [
      {
        analysisRevisionId: '50000000-0000-4000-8000-000000000001',
        stageSources: { transcription: 'created' },
        progress: 5,
      },
    ]);
  });

  it('records a reusable transcription without starting a new model job', async () => {
    const updates = [];
    let starts = 0;
    const worker = new AudioAutomationWorker({
      repository: {
        reusableRevision: async () => '50000000-0000-4000-8000-000000000001',
        setStageReference: async (_id, update) => updates.push(update),
      },
      audio: {
        startAudioTranscription: async () => {
          starts += 1;
        },
      },
    });

    await worker.advance({ ...baseTask, phase: 'transcription', analysisRevisionId: null });

    assert.equal(starts, 0);
    assert.deepEqual(updates[0].stageSources, { transcription: 'reused' });
  });

  it('records skipped and unavailable optional post-analysis stages', async () => {
    const updates = [];
    const warnings = [];
    const worker = new AudioAutomationWorker({
      repository: {
        postAnalysisReferences: async () => ({ emotionJobId: null, roleJobId: null }),
        addWarning: async (_id, code) => warnings.push(code),
        setStageReference: async (_id, update) => updates.push(update),
      },
      audio: {},
    });

    await worker.advance({
      ...baseTask,
      runtimeMode: 'lightweight_local',
      phase: 'post_analysis',
      analysisRevisionId: '50000000-0000-4000-8000-000000000001',
      pipeline: { ...baseTask.pipeline, includeRole: false },
    });

    assert.deepEqual(warnings, ['EMOTION_UNAVAILABLE']);
    assert.deepEqual(updates[0].stageSources, {
      emotion: 'unavailable',
      role: 'skipped',
    });
  });

  it('records reused business analysis and creates no duplicate model execution', async () => {
    const updates = [];
    const worker = new AudioAutomationWorker({
      repository: {
        setStageReference: async (_id, update) => updates.push(update),
        setBusinessLimitations: async () => undefined,
      },
      audio: {
        startAudioBusinessAnalysis: async () => ({
          jobId: '80000000-0000-4000-8000-000000000001',
          reused: true,
          status: 'ready',
        }),
      },
    });

    await worker.advance({
      ...baseTask,
      phase: 'business_analysis',
      analysisRevisionId: '50000000-0000-4000-8000-000000000001',
    });

    assert.deepEqual(updates, [
      {
        businessJobId: '80000000-0000-4000-8000-000000000001',
        stageSources: { businessAnalysis: 'reused' },
        progress: 80,
      },
    ]);
  });

  it('writes one batch manifest only when completion creates the terminal event', async () => {
    const starts = [];
    const terminalEvents = ['COMPLETED', null];
    const manifest = {
      tasks: [{ stageSources: { transcription: 'reused', businessAnalysis: 'reused' } }],
    };
    const worker = new AudioAutomationWorker({
      repository: {
        complete: async () => terminalEvents.shift(),
        batchExecutionManifest: async () => manifest,
      },
      audio: {},
      reporter: {
        start: (input) => {
          starts.push(input);
          return {
            recordMetadata: () => undefined,
            recordStep: () => undefined,
            beginModelCall: () => undefined,
            recordModelCall: () => undefined,
            beginToolCall: () => undefined,
            recordToolCall: () => undefined,
            recordContext: () => undefined,
            recordReasoning: () => undefined,
            recordOutput: () => undefined,
            finish: async () => undefined,
          };
        },
      },
    });

    await worker.advance({ ...baseTask, phase: 'done', analysisRevisionId: null });
    await worker.advance({ ...baseTask, phase: 'done', analysisRevisionId: null });

    assert.equal(starts.length, 1);
    assert.equal(starts[0].kind, 'audio-analysis-batch');
    assert.equal(starts[0].fileId, baseTask.batchId);
    assert.deepEqual(starts[0].metadata.manifest, manifest);
  });

  it('keeps a completed task successful when the batch report writer fails', async () => {
    let completed = 0;
    const worker = new AudioAutomationWorker({
      repository: {
        complete: async () => {
          completed += 1;
          return 'COMPLETED';
        },
        batchExecutionManifest: async () => ({ tasks: [] }),
      },
      audio: {},
      reporter: {
        start: () => ({
          finish: async () => {
            throw new Error('disk unavailable');
          },
        }),
      },
    });

    await assert.doesNotReject(
      worker.advance({ ...baseTask, phase: 'done', analysisRevisionId: null }),
    );
    assert.equal(completed, 1);
  });

  it('continues after permanent emotion and role failures with warnings', async () => {
    const warnings = [];
    const updates = [];
    const worker = new AudioAutomationWorker({
      repository: {
        postAnalysisReferences: async () => ({ emotionJobId: null, roleJobId: null }),
        postAnalysisState: async () => ({
          status: 'failed',
          errorCode: 'INVALID_MODEL_OUTPUT',
          errorMessage: '输出不可解析',
          errorRetryable: false,
          progress: 100,
        }),
        addWarning: async (_id, code) => warnings.push(code),
        setStageReference: async (_id, update) => updates.push(update),
      },
      audio: {},
    });
    await worker.advance({
      ...baseTask,
      phase: 'post_analysis',
      analysisRevisionId: '50000000-0000-4000-8000-000000000001',
      emotionJobId: '60000000-0000-4000-8000-000000000001',
      roleJobId: '70000000-0000-4000-8000-000000000001',
    });
    assert.deepEqual(warnings, ['EMOTION_UNAVAILABLE', 'ROLE_UNAVAILABLE']);
    assert.deepEqual(updates.at(-1), { phase: 'business_analysis', progress: 75 });
  });

  it('hard-blocks only when a stored 429 explicitly reports exhausted quota', async () => {
    const blocked = [];
    const worker = new AudioAutomationWorker({
      repository: {
        transcriptionState: async () => ({
          status: 'failed',
          errorCode: 'HTTP_429',
          errorMessage: 'Account quota exhausted',
          errorRetryable: false,
          progress: 20,
        }),
        block: async (...args) => blocked.push(args),
      },
      audio: {},
    });
    await worker.advance({
      ...baseTask,
      phase: 'transcription',
      analysisRevisionId: '50000000-0000-4000-8000-000000000001',
    });
    assert.equal(blocked[0][1], 'API_QUOTA_EXCEEDED');
    assert.equal(blocked[0][2], 'audio_transcription');
  });
});
