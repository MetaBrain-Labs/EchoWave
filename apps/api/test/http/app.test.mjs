import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { HelloResponseSchema } from '@echowave/contracts';

import { createApp } from '../../dist/http/app.js';

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
  const workspaceService = {
    listGroups: async () => ({ items: [{
      id: groupId,
      name: '产品研究组',
      metrics: { analysisCount: 1, audioCount: 2, knowledgeCount: 1, sourceCount: 1 },
      updatedAt: '2026-08-21T10:00:00.000Z',
    }] }),
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
    archiveGroup: async (id) => { archivedGroupId = id; },
    listGroupAudioFiles: async () => ({ items: [] }),
    listGroupKnowledgeBases: async () => ({ items: [] }),
    listKnowledgeBaseGroups: async () => ({ items: [] }),
    linkKnowledgeBaseGroups: async (id, input) => {
      linkedKnowledgeInput = { id, input };
      return { items: [] };
    },
    listGroupDataSources: async () => ({ items: [] }),
    listDataSources: async () => ({ items: [] }),
    getDataSource: async () => ({}),
    listDataSourceAudioFiles: async () => ({ items: [] }),
    listDataSourceIngestionRecords: async () => ({ items: [] }),
    listDataSourceGroups: async () => ({ items: [] }),
    getAudioAnalysis: async () => ({}),
  };
  const workspaceApp = createApp(
    { corsOrigins: ['http://localhost:8081'] },
    { workspaceService },
  );

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
});
