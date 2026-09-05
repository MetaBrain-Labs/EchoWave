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
      { analysisRevisionId: '50000000-0000-4000-8000-000000000001', progress: 5 },
    ]);
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
