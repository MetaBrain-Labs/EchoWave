import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AUDIO_TRANSCRIPTION_MODEL_CAPABILITIES,
  DEFAULT_AUDIO_TRANSCRIPTION_MODEL,
  HelloResponseSchema,
} from '@echowave/contracts';

import { createApp } from '../../dist/http/app.js';
import { WorkspaceRepositoryError } from '../../dist/workspace/persistence/errors.js';
import { AudioUploadValidationError } from '../../dist/workspace/service.js';

const app = createApp({ corsOrigins: ['http://localhost:8081'] });
const groupId = '11111111-1111-4111-8111-111111111111';

describe('EchoWave API', () => {
  it('returns the shared HelloWorld contract', async () => {
    const response = await app.request('/api/hello');
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(HelloResponseSchema.parse(body), {
      ok: true,
      service: 'echowave-api',
      message: 'HelloWorld',
    });
  });

  it('returns a compact structured 404 response', async () => {
    const response = await app.request('/missing');

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found.',
        retryable: false,
      },
    });
  });
});

describe('workspace routes', () => {
  let archivedGroupId;
  let createdGroupInput;
  let linkedKnowledgeInput;
  let createdDataSourceInput;
  let updatedDataSourceInput;
  let archivedDataSourceId;
  let linkedDataSourceInput;
  let unlinkedDataSourceInput;
  let archivedAudioInput;
  let uploadedAudioInput;
  let startedTranscriptionInput;
  const workspaceService = {
    listGroups: async () => ({
      items: [
        {
          id: groupId,
          name: '产品研究组',
          metrics: { analysisCount: 1, audioCount: 2, knowledgeCount: 1, sourceCount: 1 },
          updatedAt: '2026-08-21T10:00:00.000Z',
        },
      ],
    }),
    getGroup: async () => ({
      id: groupId,
      name: '产品研究组',
      metrics: { analysisCount: 1, audioCount: 2, knowledgeCount: 1, sourceCount: 1 },
      updatedAt: '2026-08-21T10:00:00.000Z',
    }),
    createGroup: async (input) => {
      createdGroupInput = input;
      return {
        id: groupId,
        name: input.name,
        metrics: { analysisCount: 0, audioCount: 0, knowledgeCount: 0, sourceCount: 0 },
        updatedAt: '2026-08-21T10:00:00.000Z',
      };
    },
    archiveGroup: async (id) => {
      archivedGroupId = id;
    },
    listGroupAudioFiles: async () => ({ items: [] }),
    listGroupKnowledgeBases: async () => ({ items: [] }),
    listKnowledgeBaseGroups: async () => ({ items: [] }),
    linkKnowledgeBaseGroups: async (id, input) => {
      linkedKnowledgeInput = { id, input };
      return { items: [] };
    },
    listGroupDataSources: async () => ({ items: [] }),
    listDataSources: async () => ({ items: [] }),
    createDataSource: async (input) => {
      createdDataSourceInput = input;
      return { id: groupId, name: input.name, description: input.description };
    },
    getDataSource: async () => ({ id: groupId }),
    updateDataSource: async (id, input) => {
      updatedDataSourceInput = { id, input };
      return { id, ...input };
    },
    archiveDataSource: async (id) => {
      archivedDataSourceId = id;
    },
    listDataSourceAudioFiles: async () => ({ items: [] }),
    uploadDataSourceAudioFiles: async (id, files) => {
      uploadedAudioInput = { id, files };
      return { ingestionRunId: groupId, items: [] };
    },
    archiveDataSourceAudioFile: async (id, audioFileId) => {
      archivedAudioInput = { id, audioFileId };
    },
    getAudioTranscriptionCapabilities: () => ({
      defaultModel: DEFAULT_AUDIO_TRANSCRIPTION_MODEL,
      models: AUDIO_TRANSCRIPTION_MODEL_CAPABILITIES,
      ffmpeg: { configured: true, available: true },
      direct: {
        maxBytes: 209_715_200,
        maxDurationMs: 45_000,
        formats: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'webm'],
      },
    }),
    startAudioTranscription: async (id, input) => {
      startedTranscriptionInput = { id, input };
      return { audioFileId: id, revisionId: groupId, status: 'queued' };
    },
    listDataSourceIngestionRecords: async () => ({ items: [] }),
    listDataSourceGroups: async () => ({ items: [] }),
    linkDataSourceGroups: async (id, input) => {
      linkedDataSourceInput = { id, input };
      return { items: [] };
    },
    unlinkDataSourceGroup: async (id, linkedGroupId) => {
      unlinkedDataSourceInput = { id, groupId: linkedGroupId };
    },
    getAudioAnalysis: async () => ({}),
  };
  const workspaceApp = createApp({ corsOrigins: ['http://localhost:8081'] }, { workspaceService });

  it('exposes group summaries and validates route identifiers', async () => {
    const response = await workspaceApp.request('/api/groups');
    assert.equal(response.status, 200);
    assert.equal((await response.json()).items[0].name, '产品研究组');

    const invalid = await workspaceApp.request('/api/groups/not-a-uuid');
    assert.equal(invalid.status, 400);
  });

  it('creates trimmed groups and archives validated identifiers', async () => {
    const created = await workspaceApp.request('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '  客户研究组  ' }),
    });
    assert.equal(created.status, 201);
    assert.deepEqual(createdGroupInput, { name: '客户研究组' });
    assert.equal((await created.json()).name, '客户研究组');

    const archived = await workspaceApp.request(`/api/groups/${groupId}`, { method: 'DELETE' });
    assert.equal(archived.status, 204);
    assert.equal(archivedGroupId, groupId);
  });

  it('rejects invalid group creation payloads', async () => {
    const response = await workspaceApp.request('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '   ' }),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'BAD_REQUEST');
  });

  it('routes nested read models to the workspace service', async () => {
    const response = await workspaceApp.request(`/api/groups/${groupId}/audio-files`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { items: [] });
  });

  it('validates and routes knowledge-base group links', async () => {
    const linked = await workspaceApp.request(`/api/knowledge-bases/${groupId}/groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupIds: [groupId] }),
    });
    assert.equal(linked.status, 200);
    assert.deepEqual(linkedKnowledgeInput, { id: groupId, input: { groupIds: [groupId] } });

    const invalid = await workspaceApp.request(`/api/knowledge-bases/${groupId}/groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupIds: [] }),
    });
    assert.equal(invalid.status, 400);
  });

  it('routes data-source create, update, archive, and group lifecycle writes', async () => {
    const created = await workspaceApp.request('/api/data-sources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '  本地访谈  ', description: '  用户声音  ' }),
    });
    assert.equal(created.status, 201);
    assert.deepEqual(createdDataSourceInput, { name: '本地访谈', description: '用户声音' });

    const updated = await workspaceApp.request(`/api/data-sources/${groupId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: '  新描述  ' }),
    });
    assert.equal(updated.status, 200);
    assert.deepEqual(updatedDataSourceInput, {
      id: groupId,
      input: { description: '新描述' },
    });

    const invalidUpdate = await workspaceApp.request(`/api/data-sources/${groupId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(invalidUpdate.status, 400);

    const linked = await workspaceApp.request(`/api/data-sources/${groupId}/groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupIds: [groupId] }),
    });
    assert.equal(linked.status, 200);
    assert.deepEqual(linkedDataSourceInput, { id: groupId, input: { groupIds: [groupId] } });

    const unlinked = await workspaceApp.request(`/api/data-sources/${groupId}/groups/${groupId}`, {
      method: 'DELETE',
    });
    assert.equal(unlinked.status, 204);
    assert.deepEqual(unlinkedDataSourceInput, { id: groupId, groupId });

    const archived = await workspaceApp.request(`/api/data-sources/${groupId}`, {
      method: 'DELETE',
    });
    assert.equal(archived.status, 204);
    assert.equal(archivedDataSourceId, groupId);
  });

  it('routes multipart audio uploads and audio archives', async () => {
    const form = new FormData();
    form.append(
      'files',
      new File([new Uint8Array([1, 2, 3])], 'sample.mp3', { type: 'audio/mpeg' }),
    );
    const uploaded = await workspaceApp.request(`/api/data-sources/${groupId}/audio-files`, {
      method: 'POST',
      body: form,
    });
    assert.equal(uploaded.status, 201);
    assert.equal(uploadedAudioInput.id, groupId);
    assert.equal(uploadedAudioInput.files[0].name, 'sample.mp3');

    const archived = await workspaceApp.request(
      `/api/data-sources/${groupId}/audio-files/${groupId}`,
      { method: 'DELETE' },
    );
    assert.equal(archived.status, 204);
    assert.deepEqual(archivedAudioInput, { id: groupId, audioFileId: groupId });
  });

  it('queues validated audio transcription requests', async () => {
    const response = await workspaceApp.request(`/api/audio-files/${groupId}/transcriptions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'openai/gpt-transcribe', preprocessing: 'direct' }),
    });
    assert.equal(response.status, 202);
    assert.deepEqual(startedTranscriptionInput, {
      id: groupId,
      input: { model: 'openai/gpt-transcribe', preprocessing: 'direct' },
    });
    assert.deepEqual(await response.json(), {
      audioFileId: groupId,
      revisionId: groupId,
      status: 'queued',
    });

    const capabilities = await workspaceApp.request('/api/audio-transcription/capabilities');
    assert.equal(capabilities.status, 200);
    const capabilityBody = await capabilities.json();
    assert.equal(capabilityBody.ffmpeg.available, true);
    assert.equal(capabilityBody.defaultModel, 'x-ai/grok-stt-1.0');
    assert.equal(capabilityBody.models.length, 5);

    const invalid = await workspaceApp.request(`/api/audio-files/${groupId}/transcriptions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preprocessing: 'automatic' }),
    });
    assert.equal(invalid.status, 400);

    const invalidModel = await workspaceApp.request(`/api/audio-files/${groupId}/transcriptions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'unknown/model', preprocessing: 'direct' }),
    });
    assert.equal(invalidModel.status, 400);
  });

  it('returns 503 before queuing when selected FFmpeg is unavailable', async () => {
    const unavailableApp = createApp(
      { corsOrigins: ['http://localhost:8081'] },
      {
        workspaceService: {
          ...workspaceService,
          startAudioTranscription: async () => {
            throw new WorkspaceRepositoryError(
              'TRANSCODER_UNAVAILABLE',
              'FFmpeg 当前不可用，请取消预处理后直接转写。',
            );
          },
        },
      },
    );
    const response = await unavailableApp.request(`/api/audio-files/${groupId}/transcriptions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preprocessing: 'ffmpeg' }),
    });

    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, 'TRANSCODER_UNAVAILABLE');
  });

  it('returns stable audio validation errors', async () => {
    const validationApp = createApp(
      { corsOrigins: ['http://localhost:8081'] },
      {
        workspaceService: {
          ...workspaceService,
          uploadDataSourceAudioFiles: async () => {
            throw new AudioUploadValidationError('TOO_MANY_FILES', '单批最多上传 20 个音频文件。');
          },
        },
      },
    );
    const response = await validationApp.request(`/api/data-sources/${groupId}/audio-files`, {
      method: 'POST',
      body: new FormData(),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: {
        code: 'TOO_MANY_FILES',
        message: '单批最多上传 20 个音频文件。',
        retryable: false,
      },
    });
  });
});
