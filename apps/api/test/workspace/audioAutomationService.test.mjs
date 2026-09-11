/**
 * 自动分析应用服务测试。
 *
 * 验证批量上传编排只向上传会话服务传递其契约允许的字段，避免客户端标识污染严格输入校验。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AudioAutomationService } from '../../dist/workspace/audio/automation/service.js';

const batchId = '11111111-1111-4111-8111-111111111111';
const taskId = '22222222-2222-4222-8222-222222222222';
const audioFileId = '33333333-3333-4333-8333-333333333333';
const dataSourceId = '44444444-4444-4444-8444-444444444444';
const groupId = '55555555-5555-4555-8555-555555555555';
const timestamp = '2026-09-11T10:00:00.000Z';

const batch = {
  id: batchId,
  dataSourceId,
  groupId,
  source: 'uploads',
  scheduledFor: null,
  configurationSnapshot: {
    groupName: '销售组',
    language: 'zh-CN',
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
    models: {
      transcription: null,
      emotion: null,
      role: null,
      businessAnalysis: null,
    },
  },
  counts: {
    total: 1,
    active: 1,
    blocked: 0,
    completed: 0,
    partial: 0,
    failed: 0,
    canceled: 0,
  },
  tasks: [
    {
      id: taskId,
      batchId,
      audioFileId: null,
      title: '重点分析 送礼客户',
      runtimeMode: 'hybrid',
      status: 'awaiting_upload',
      phase: 'upload',
      progress: 0,
      runAfter: null,
      warningCodes: [],
      blocker: null,
      error: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      report: null,
      reportAvailable: false,
    },
  ],
  createdAt: timestamp,
};

describe('AudioAutomationService', () => {
  it('does not pass clientItemId into the strict upload session request', async () => {
    let uploadInput;
    const uploads = {
      currentRuntimeMode: async () => 'hybrid',
      create: async (_dataSourceId, input) => {
        uploadInput = input;
        return {
          id: '66666666-6666-4666-8666-666666666666',
          audioFileId,
          mode: 'hybrid',
          upload: {
            kind: 'api_binary',
            url: '/api/audio-upload-sessions/66666666-6666-4666-8666-666666666666/content',
            headers: { 'Content-Type': 'audio/mpeg' },
          },
          expiresAt: timestamp,
        };
      },
    };
    const repository = {
      createBatch: async () => ({
        batchId,
        tasks: [
          { id: taskId, clientItemId: 'file-0-重点分析-送礼客户.mp3-477584', audioFileId: null },
        ],
      }),
      getBatch: async () => batch,
      failUpload: async () => {
        throw new Error('failUpload should not be called');
      },
    };
    const settings = { resolveCapability: async () => null };
    const service = new AudioAutomationService(repository, uploads, settings);

    await service.create({
      dataSourceId,
      groupId,
      language: 'zh-CN',
      scheduledFor: null,
      pipeline: {
        confirmation: 'system_raw_snapshot',
        includeEmotion: true,
        includeRole: true,
        includeBusinessAnalysis: true,
        transcriptPolicy: 'reuse_or_create',
      },
      source: 'uploads',
      items: [
        {
          clientItemId: 'file-0-重点分析-送礼客户.mp3-477584',
          filename: '重点分析 送礼客户.mp3',
          mimeType: 'audio/mpeg',
          sizeBytes: 477584,
        },
      ],
    });

    assert.deepEqual(uploadInput, {
      filename: '重点分析 送礼客户.mp3',
      mimeType: 'audio/mpeg',
      sizeBytes: 477584,
      includeAcousticEmotion: true,
    });
    assert.equal('clientItemId' in uploadInput, false);
  });
});
