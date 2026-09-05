import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  AUDIO_TRANSCRIPTION_MODEL_CAPABILITIES,
  DEFAULT_AUDIO_TRANSCRIPTION_MODEL,
  HealthResponseSchema,
  HelloResponseSchema,
} from '@echowave/contracts';

import { createApp } from '../../dist/http/app.js';
import { LiveUpdateBroker } from '../../dist/infrastructure/liveUpdateBroker.js';
import { WorkspaceRepositoryError } from '../../dist/workspace/errors.js';
import { AudioUploadValidationError } from '../../dist/workspace/data-sources/service.js';
import { DashScopeCallbackError } from '../../dist/workspace/audio/transcription/dashScopeCallback.js';

const app = createApp({ corsOrigins: ['http://localhost:8081'] });
const groupId = '11111111-1111-4111-8111-111111111111';

describe('EchoWave API', () => {
  it('returns the public self-hosted health contract and capabilities', async () => {
    const response = await app.request('/health');
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(HealthResponseSchema.parse(body), {
      name: 'EchoWave',
      service: 'echowave-api',
      version: '0.1.0',
      apiVersion: 1,
      status: 'ok',
      capabilities: { remotePush: false },
    });

    const pushEnabledApp = createApp(
      { corsOrigins: ['http://localhost:8081'] },
      { remotePushEnabled: true },
    );
    assert.deepEqual(await (await pushEnabledApp.request('/health')).json(), {
      ...body,
      capabilities: { remotePush: true },
    });
  });

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

describe('DashScope callback route', () => {
  it('is not registered when EventBridge mode does not provide a callback service', async () => {
    const pollingApp = createApp({ corsOrigins: ['http://localhost:8081'] });
    const response = await pollingApp.request('/api/webhooks/dashscope/async-task-finished', {
      method: 'POST',
      body: '{}',
    });
    assert.equal(response.status, 404);
  });

  it('passes the exact raw body and headers to the callback service', async () => {
    let received;
    const callbackApp = createApp(
      { corsOrigins: ['http://localhost:8081'] },
      {
        dashScopeCallbackService: {
          receive: async (rawBody, headers) => {
            received = { rawBody, token: headers.get('x-eventbridge-signature-token') };
            return 'accepted';
          },
        },
      },
    );
    const rawBody = '{"id":"event-1", "spacing":"preserved"}';
    const response = await callbackApp.request('/api/webhooks/dashscope/async-task-finished', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-eventbridge-signature-token': 'secret',
      },
      body: rawBody,
    });
    assert.equal(response.status, 204);
    assert.deepEqual(received, { rawBody, token: 'secret' });
  });

  it('maps invalid signatures and transient persistence failures', async () => {
    for (const [kind, expectedStatus] of [
      ['unauthorized', 401],
      ['temporary_unavailable', 503],
    ]) {
      const callbackApp = createApp(
        { corsOrigins: ['http://localhost:8081'] },
        {
          dashScopeCallbackService: {
            receive: async () => {
              throw new DashScopeCallbackError(kind, 'rejected');
            },
          },
        },
      );
      const response = await callbackApp.request('/api/webhooks/dashscope/async-task-finished', {
        method: 'POST',
        body: '{}',
      });
      assert.equal(response.status, expectedStatus);
    }
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
  let startedPostAnalysisInput;
  let startedBusinessAnalysisInput;
  let confirmedTranscriptInput;
  let resolvedSpeakerFindingInput;
  let resolvedAllSpeakerFindingsId;
  let updatedGroupSettingsInput;
  let replacedGroupKnowledgeInput;
  let replacedGroupSourcesInput;
  let requestedAnalysisInput;
  let requestedExecutionTraceInput;
  let requestedExecutionStreamSnapshotInput;
  const requestedExecutionStreamEventsInputs = [];
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
    getGroupSettings: async (id) => ({
      groupId: id,
      name: '产品研究组',
      analysis: {
        timing: 'automatic',
        contentFocus: '分析销售话术',
        tone: '正式、专业',
        customTags: [],
      },
      updatedAt: '2026-08-28T08:00:00.000Z',
    }),
    updateGroupSettings: async (id, input) => {
      updatedGroupSettingsInput = { id, input };
      return {
        groupId: id,
        ...input,
        updatedAt: '2026-08-28T08:01:00.000Z',
      };
    },
    listGroupAudioFiles: async () => ({ items: [] }),
    listGroupKnowledgeBases: async () => ({ items: [] }),
    replaceGroupKnowledgeBases: async (id, input) => {
      replacedGroupKnowledgeInput = { id, input };
      return { items: [] };
    },
    listKnowledgeBaseGroups: async () => ({ items: [] }),
    linkKnowledgeBaseGroups: async (id, input) => {
      linkedKnowledgeInput = { id, input };
      return { items: [] };
    },
    listGroupDataSources: async () => ({ items: [] }),
    replaceGroupDataSources: async (id, input) => {
      replacedGroupSourcesInput = { id, input };
      return { items: [] };
    },
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
      sileroVad: { model: 'silero-vad-v6.2.1', available: true, unavailableReason: null },
      transcriptionConfigured: true,
    }),
    startAudioTranscription: async (id, input) => {
      startedTranscriptionInput = { id, input };
      return { audioFileId: id, revisionId: groupId, status: 'queued' };
    },
    confirmAudioTranscript: async (id, input) => {
      confirmedTranscriptInput = { id, input };
      return {
        audioFileId: id,
        analysisRevisionId: input.analysisRevisionId,
        confirmationId: groupId,
        version: input.baseVersion + 1,
        confirmedAt: '2026-08-28T01:00:00.000Z',
      };
    },
    resolveSpeakerReviewFinding: async (id, findingId) => {
      resolvedSpeakerFindingInput = { id, findingId };
      return { audioFileId: id, resolvedCount: 1 };
    },
    resolveAllSpeakerReviewFindings: async (id) => {
      resolvedAllSpeakerFindingsId = id;
      return { audioFileId: id, resolvedCount: 3 };
    },
    startAudioPostAnalysis: async (id, type) => {
      startedPostAnalysisInput = { id, type };
      return {
        audioFileId: id,
        revisionId: groupId,
        jobId: groupId,
        type,
        status: 'queued',
      };
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
    getAudioAnalysis: async (id, requestedGroupId) => {
      requestedAnalysisInput = { id, groupId: requestedGroupId };
      return {};
    },
    getAudioExecutionTrace: async (id, requestedGroupId) => {
      requestedExecutionTraceInput = { id, groupId: requestedGroupId };
      return { audioFileId: id, analysisRevisionId: groupId, runs: [] };
    },
    getAudioExecutionStreamSnapshot: async (id, requestedGroupId) => {
      requestedExecutionStreamSnapshotInput = { id, groupId: requestedGroupId };
      return {
        type: 'snapshot',
        cursor: '4',
        audioFileId: id,
        analysisRevisionId: groupId,
        trace: { audioFileId: id, analysisRevisionId: groupId, runs: [] },
      };
    },
    getAudioExecutionStreamEvents: async (id, revisionId, requestedGroupId, cursor) => {
      requestedExecutionStreamEventsInputs.push({
        id,
        revisionId,
        groupId: requestedGroupId,
        cursor,
      });
      if (cursor === '4') {
        return [
          {
            type: 'model-start',
            cursor: '5',
            audioFileId: id,
            analysisRevisionId: revisionId,
            runId: groupId,
            operationId: groupId,
            modelCall: {
              id: groupId,
              sequence: 2,
              operation: 'business-analysis-generation',
              name: '结合转写与知识证据生成业务分析',
              provider: 'deepseek',
              model: 'deepseek-v4-flash',
              status: 'running',
              attempt: 1,
              startedAt: '2026-08-29T01:00:00.000Z',
              completedAt: null,
              durationMs: null,
              inputTokens: null,
              outputTokens: null,
              reasoningMode: 'streaming',
              reasoningContent: '',
              reasoningTruncated: false,
              estimatedCost: null,
            },
          },
        ];
      }
      throw new Error('close test stream');
    },
    startAudioBusinessAnalysis: async (id, input) => {
      startedBusinessAnalysisInput = { id, input };
      return {
        audioFileId: id,
        groupId: input.groupId,
        revisionId: groupId,
        jobId: groupId,
        status: 'queued',
        reused: false,
      };
    },
    getAudioPlaybackFile: async () => {
      throw new WorkspaceRepositoryError('NOT_FOUND', '音频不存在。');
    },
  };
  const liveUpdateBroker = new LiveUpdateBroker();
  const workspaceApp = createApp(
    { corsOrigins: ['http://localhost:8081'] },
    {
      groupService: workspaceService,
      dataSourceService: workspaceService,
      audioService: workspaceService,
      liveUpdateBroker,
    },
  );

  const wakeExecutionStream = () => {
    setTimeout(
      () =>
        liveUpdateBroker.publish({
          kind: 'audio-execution',
          audioFileId: groupId,
          analysisRevisionId: groupId,
        }),
      0,
    );
    setTimeout(
      () =>
        liveUpdateBroker.publish({
          kind: 'audio-execution',
          audioFileId: groupId,
          analysisRevisionId: groupId,
        }),
      20,
    );
  };

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

  it('validates group analysis settings and atomically replaced associations', async () => {
    const updated = await workspaceApp.request(`/api/groups/${groupId}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '  销售复盘组  ',
        analysis: {
          timing: 'manual',
          contentFocus: '  分析异议处理  ',
          tone: '  正式、专业  ',
          customTags: ['需求探索'],
        },
      }),
    });
    assert.equal(updated.status, 200);
    assert.equal(updatedGroupSettingsInput.input.name, '销售复盘组');
    assert.equal(updatedGroupSettingsInput.input.analysis.contentFocus, '分析异议处理');

    const knowledge = await workspaceApp.request(`/api/groups/${groupId}/knowledge-bases`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [groupId] }),
    });
    assert.equal(knowledge.status, 200);
    assert.deepEqual(replacedGroupKnowledgeInput, { id: groupId, input: { ids: [groupId] } });

    const sources = await workspaceApp.request(`/api/groups/${groupId}/data-sources`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [] }),
    });
    assert.equal(sources.status, 200);
    assert.deepEqual(replacedGroupSourcesInput, { id: groupId, input: { ids: [] } });

    const duplicate = await workspaceApp.request(`/api/groups/${groupId}/knowledge-bases`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [groupId, groupId] }),
    });
    assert.equal(duplicate.status, 400);
  });

  it('requires a valid group context for business analysis reads and starts', async () => {
    const detail = await workspaceApp.request(
      `/api/audio-files/${groupId}/analysis?groupId=${groupId}`,
    );
    assert.equal(detail.status, 200);
    assert.deepEqual(requestedAnalysisInput, { id: groupId, groupId });

    const trace = await workspaceApp.request(
      `/api/audio-files/${groupId}/analysis/executions?groupId=${groupId}`,
    );
    assert.equal(trace.status, 200);
    assert.deepEqual(requestedExecutionTraceInput, { id: groupId, groupId });

    const started = await workspaceApp.request(`/api/audio-files/${groupId}/business-analyses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId, force: true }),
    });
    assert.equal(started.status, 202);
    assert.deepEqual(startedBusinessAnalysisInput, {
      id: groupId,
      input: { groupId, force: true },
    });

    const invalid = await workspaceApp.request(`/api/audio-files/${groupId}/business-analyses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId: 'not-a-uuid' }),
    });
    assert.equal(invalid.status, 400);
  });

  it('streams an initial execution snapshot and cursor-ordered lifecycle events', async () => {
    requestedExecutionStreamEventsInputs.length = 0;
    wakeExecutionStream();
    const response = await workspaceApp.request(
      `/api/audio-files/${groupId}/analysis/executions/stream?groupId=${groupId}`,
    );
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/event-stream/);
    assert.equal(response.headers.get('x-accel-buffering'), 'no');
    const body = await response.text();

    assert.match(body, /event: snapshot/);
    assert.match(body, /event: model-start/);
    assert.match(body, /event: error/);
    assert.deepEqual(requestedExecutionStreamSnapshotInput, { id: groupId, groupId });
    assert.deepEqual(requestedExecutionStreamEventsInputs[0], {
      id: groupId,
      revisionId: groupId,
      groupId,
      cursor: '4',
    });
    assert.equal(requestedExecutionStreamEventsInputs[1].cursor, '5');
  });

  it('continues execution SSE from a cursor and rejects malformed cursors', async () => {
    requestedExecutionStreamEventsInputs.length = 0;
    wakeExecutionStream();
    const continued = await workspaceApp.request(
      `/api/audio-files/${groupId}/analysis/executions/stream?groupId=${groupId}&cursor=4`,
    );
    const body = await continued.text();
    assert.doesNotMatch(body, /event: snapshot/);
    assert.match(body, /event: error/);
    assert.equal(requestedExecutionStreamEventsInputs[0].cursor, '4');

    const invalid = await workspaceApp.request(
      `/api/audio-files/${groupId}/analysis/executions/stream?groupId=${groupId}&cursor=bad`,
    );
    assert.equal(invalid.status, 400);
  });

  it('streams data-source audio updates only after broker signals', async () => {
    const broker = new LiveUpdateBroker();
    let reads = 0;
    const streamApp = createApp(
      { corsOrigins: ['http://localhost:8081'] },
      {
        liveUpdateBroker: broker,
        dataSourceService: {
          ...workspaceService,
          listDataSourceAudioFiles: async () => {
            reads += 1;
            if (reads >= 3) throw new Error('close test stream');
            return {
              items: [
                {
                  id: groupId,
                  sourceId: groupId,
                  title: '客户访谈',
                  durationMs: 1_000,
                  createdAt: '2026-08-30T01:00:00.000Z',
                  sharedFrom: null,
                  hasTranscript: false,
                  status:
                    reads === 1
                      ? { kind: 'waiting' }
                      : { kind: 'transcribing', progress: 35, activity: null },
                },
              ],
            };
          },
        },
      },
    );
    setTimeout(
      () =>
        broker.publish({
          kind: 'data-source-audio',
          dataSourceId: groupId,
          audioFileId: groupId,
          terminal: false,
        }),
      0,
    );
    setTimeout(
      () =>
        broker.publish({
          kind: 'data-source-audio',
          dataSourceId: groupId,
          audioFileId: groupId,
          terminal: false,
        }),
      20,
    );

    const response = await streamApp.request(`/api/data-sources/${groupId}/audio-files/stream`);
    const body = await response.text();
    assert.match(body, /event: snapshot/);
    assert.match(body, /event: audio-file/);
    assert.match(body, /event: error/);
    assert.equal(reads, 3);
  });

  it('streams analysis status updates only after matching broker signals', async () => {
    const broker = new LiveUpdateBroker();
    let reads = 0;
    const streamApp = createApp(
      { corsOrigins: ['http://localhost:8081'] },
      {
        liveUpdateBroker: broker,
        audioService: {
          ...workspaceService,
          getAudioAnalysis: async () => {
            reads += 1;
            if (reads >= 3) throw new Error('close test stream');
            return {
              id: groupId,
              postAnalysis: {
                emotion: { state: 'idle' },
                role: { state: 'idle' },
              },
              businessAnalysis: {
                state: reads === 1 ? 'queued' : 'running',
                groupId,
                jobId: groupId,
                model: 'deepseek-v4-flash',
                progress: reads === 1 ? 0 : 35,
                confirmationVersion: 1,
                settingsCurrent: true,
                knowledgeCurrent: true,
                error: null,
                result: null,
              },
            };
          },
        },
      },
    );
    setTimeout(
      () =>
        broker.publish({
          kind: 'audio-analysis',
          audioFileId: groupId,
          groupId,
          terminal: false,
        }),
      0,
    );
    setTimeout(
      () =>
        broker.publish({
          kind: 'audio-analysis',
          audioFileId: groupId,
          groupId,
          terminal: true,
        }),
      20,
    );

    const response = await streamApp.request(
      `/api/audio-files/${groupId}/analysis/status/stream?groupId=${groupId}`,
    );
    const body = await response.text();
    assert.match(body, /event: snapshot/);
    assert.match(body, /event: analysis-status/);
    assert.match(body, /event: error/);
    assert.equal(reads, 3);
  });

  it('streams knowledge-document updates only after matching broker signals', async () => {
    const broker = new LiveUpdateBroker();
    let reads = 0;
    const streamApp = createApp(
      { corsOrigins: ['http://localhost:8081'] },
      {
        liveUpdateBroker: broker,
        knowledgeService: {
          listDocuments: async () => {
            reads += 1;
            if (reads >= 3) throw new Error('close test stream');
            return {
              items: [
                {
                  id: groupId,
                  knowledgeBaseId: groupId,
                  title: 'Product handbook',
                  format: 'markdown',
                  sizeBytes: 128,
                  status: reads === 1 ? { kind: 'queued' } : { kind: 'embedding', progress: 35 },
                  vectorCount: 0,
                  updatedAt: '2026-08-30T01:00:00.000Z',
                },
              ],
            };
          },
        },
      },
    );
    setTimeout(
      () =>
        broker.publish({
          kind: 'knowledge-document',
          knowledgeBaseId: groupId,
          documentId: groupId,
          terminal: false,
        }),
      0,
    );
    setTimeout(
      () =>
        broker.publish({
          kind: 'knowledge-document',
          knowledgeBaseId: groupId,
          documentId: groupId,
          terminal: true,
        }),
      20,
    );

    const response = await streamApp.request(`/api/knowledge-bases/${groupId}/documents/stream`);
    const body = await response.text();
    assert.match(body, /event: snapshot/);
    assert.match(body, /event: document/);
    assert.match(body, /event: error/);
    assert.equal(reads, 3);
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
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 202);
    assert.deepEqual(startedTranscriptionInput, {
      id: groupId,
      input: {
        includeAcousticEmotion: true,
        preprocessing: 'whole_file',
        segmentationMode: 'speaker_turn',
      },
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
    assert.equal(capabilityBody.defaultModel, 'qwen-audio-3.0-asr-flash-filetrans');
    assert.equal(capabilityBody.models.length, 1);

    const invalid = await workspaceApp.request(`/api/audio-files/${groupId}/transcriptions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preprocessing: 'automatic' }),
    });
    assert.equal(invalid.status, 400);

    const invalidModel = await workspaceApp.request(`/api/audio-files/${groupId}/transcriptions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'unknown/model', preprocessing: 'whole_file' }),
    });
    assert.equal(invalidModel.status, 400);
  });

  it('validates and publishes a complete transcript confirmation', async () => {
    const response = await workspaceApp.request(
      `/api/audio-files/${groupId}/transcript-confirmations`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analysisRevisionId: groupId,
          baseVersion: 0,
          segments: [
            {
              sourceSegmentId: groupId,
              parts: [
                {
                  speakerKey: 'Speaker 0',
                  startWordIndex: 0,
                  endWordIndex: 1,
                  text: '  修正正文  ',
                },
              ],
            },
          ],
        }),
      },
    );
    assert.equal(response.status, 201);
    assert.deepEqual(confirmedTranscriptInput, {
      id: groupId,
      input: {
        analysisRevisionId: groupId,
        baseVersion: 0,
        segments: [
          {
            sourceSegmentId: groupId,
            parts: [
              {
                speakerKey: 'Speaker 0',
                startWordIndex: 0,
                endWordIndex: 1,
                text: '修正正文',
              },
            ],
          },
        ],
      },
    });
    assert.equal((await response.json()).version, 1);

    const invalid = await workspaceApp.request(
      `/api/audio-files/${groupId}/transcript-confirmations`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analysisRevisionId: groupId,
          baseVersion: 0,
          segments: [
            {
              sourceSegmentId: groupId,
              parts: [{ speakerKey: 'Speaker 0', startWordIndex: 0, endWordIndex: 1, text: '甲' }],
            },
            {
              sourceSegmentId: groupId,
              parts: [{ speakerKey: 'Speaker 0', startWordIndex: 0, endWordIndex: 1, text: '乙' }],
            },
          ],
        }),
      },
    );
    assert.equal(invalid.status, 400);
  });

  it('resolves one or all speaker review findings', async () => {
    const one = await workspaceApp.request(
      `/api/audio-files/${groupId}/speaker-review-findings/${groupId}`,
      { method: 'DELETE' },
    );
    assert.equal(one.status, 200);
    assert.deepEqual(resolvedSpeakerFindingInput, { id: groupId, findingId: groupId });
    assert.deepEqual(await one.json(), { audioFileId: groupId, resolvedCount: 1 });

    const all = await workspaceApp.request(`/api/audio-files/${groupId}/speaker-review-findings`, {
      method: 'DELETE',
    });
    assert.equal(all.status, 200);
    assert.equal(resolvedAllSpeakerFindingsId, groupId);
    assert.deepEqual(await all.json(), { audioFileId: groupId, resolvedCount: 3 });
  });

  it('streams full, HEAD, and ranged audio responses with media CORS headers', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'echowave-http-audio-'));
    const absolutePath = path.join(root, 'sample.wav');
    await writeFile(absolutePath, Buffer.from('0123456789'));
    const mediaApp = createApp(
      { corsOrigins: ['http://localhost:8081'] },
      {
        audioService: {
          ...workspaceService,
          getAudioPlaybackFile: async () => ({
            absolutePath,
            lastModified: new Date('2026-08-28T00:00:00.000Z'),
            mimeType: 'audio/wav',
            originalFilename: '客户访谈.wav',
            sizeBytes: 10,
          }),
        },
      },
    );
    try {
      const full = await mediaApp.request(`/api/audio-files/${groupId}/content`);
      assert.equal(full.status, 200);
      assert.equal(full.headers.get('accept-ranges'), 'bytes');
      assert.equal(full.headers.get('content-length'), '10');
      assert.equal(full.headers.get('content-type'), 'audio/wav');
      assert.equal(Buffer.from(await full.arrayBuffer()).toString(), '0123456789');

      const head = await mediaApp.request(`/api/audio-files/${groupId}/content`, {
        method: 'HEAD',
      });
      assert.equal(head.status, 200);
      assert.equal(head.headers.get('content-length'), '10');
      assert.equal((await head.arrayBuffer()).byteLength, 0);

      const partial = await mediaApp.request(`/api/audio-files/${groupId}/content`, {
        headers: { Range: 'bytes=2-5' },
      });
      assert.equal(partial.status, 206);
      assert.equal(partial.headers.get('content-range'), 'bytes 2-5/10');
      assert.equal(Buffer.from(await partial.arrayBuffer()).toString(), '2345');

      const suffix = await mediaApp.request(`/api/audio-files/${groupId}/content`, {
        headers: { Range: 'bytes=-3' },
      });
      assert.equal(suffix.status, 206);
      assert.equal(Buffer.from(await suffix.arrayBuffer()).toString(), '789');

      const invalid = await mediaApp.request(`/api/audio-files/${groupId}/content`, {
        headers: { Range: 'bytes=20-' },
      });
      assert.equal(invalid.status, 416);
      assert.equal(invalid.headers.get('content-range'), 'bytes */10');

      const preflight = await mediaApp.request(`/api/audio-files/${groupId}/content`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:8081',
          'Access-Control-Request-Headers': 'Range',
          'Access-Control-Request-Method': 'GET',
        },
      });
      assert.match(preflight.headers.get('access-control-allow-headers') ?? '', /Range/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('returns a structured conflict for a stale transcript confirmation', async () => {
    const conflictApp = createApp(
      { corsOrigins: ['http://localhost:8081'] },
      {
        audioService: {
          ...workspaceService,
          confirmAudioTranscript: async () => {
            throw new WorkspaceRepositoryError('CONFLICT', '确认版本已变化，请重新加载后再编辑。');
          },
        },
      },
    );
    const response = await conflictApp.request(
      `/api/audio-files/${groupId}/transcript-confirmations`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analysisRevisionId: groupId,
          baseVersion: 1,
          segments: [
            {
              sourceSegmentId: groupId,
              parts: [
                { speakerKey: 'Speaker 0', startWordIndex: 0, endWordIndex: 1, text: '修改' },
              ],
            },
          ],
        }),
      },
    );
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, 'CONFLICT');
  });

  it('queues emotion and role post-analysis independently', async () => {
    const emotion = await workspaceApp.request(`/api/audio-files/${groupId}/analysis/emotion`, {
      method: 'POST',
    });
    assert.equal(emotion.status, 202);
    assert.deepEqual(startedPostAnalysisInput, { id: groupId, type: 'emotion' });
    assert.deepEqual(await emotion.json(), {
      audioFileId: groupId,
      revisionId: groupId,
      jobId: groupId,
      type: 'emotion',
      status: 'queued',
    });

    const role = await workspaceApp.request(`/api/audio-files/${groupId}/analysis/role`, {
      method: 'POST',
    });
    assert.equal(role.status, 202);
    assert.deepEqual(startedPostAnalysisInput, { id: groupId, type: 'role' });
    assert.equal((await role.json()).type, 'role');
  });

  it('returns structured post-analysis conflicts', async () => {
    const conflictApp = createApp(
      { corsOrigins: ['http://localhost:8081'] },
      {
        audioService: {
          ...workspaceService,
          startAudioPostAnalysis: async () => {
            throw new WorkspaceRepositoryError('CONFLICT', '该类型已有进行中的分析任务。');
          },
        },
      },
    );
    const response = await conflictApp.request(`/api/audio-files/${groupId}/analysis/emotion`, {
      method: 'POST',
    });

    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: {
        code: 'CONFLICT',
        message: '该类型已有进行中的分析任务。',
        retryable: false,
      },
    });
  });

  it('returns 503 before queuing when selected FFmpeg is unavailable', async () => {
    const unavailableApp = createApp(
      { corsOrigins: ['http://localhost:8081'] },
      {
        audioService: {
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
      body: JSON.stringify({ preprocessing: 'whole_file' }),
    });

    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, 'TRANSCODER_UNAVAILABLE');
  });

  it('returns stable audio validation errors', async () => {
    const validationApp = createApp(
      { corsOrigins: ['http://localhost:8081'] },
      {
        dataSourceService: {
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
