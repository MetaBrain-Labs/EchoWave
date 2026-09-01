/**
 * 配置中心 HTTP 安全边界测试。
 *
 * 验证管理口令、公开安全状态、远程 HTTP Secret 拒绝和 Local alias 普通配置写入。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createApp } from '../../dist/http/app.js';
import { SettingsError } from '../../dist/settings/types.js';

const providerId = '11111111-1111-4111-8111-111111111111';
const localProvider = {
  id: providerId,
  type: 'deepseek',
  name: '本地 DeepSeek',
  revision: 1,
  config: { baseUrl: 'https://api.deepseek.com' },
  credential: {
    source: 'local_file',
    configured: true,
    alias: 'deepseek-main',
    maskedValue: null,
  },
  updatedAt: '2026-09-01T00:00:00.000Z',
};

function settingsApp() {
  let createdInput;
  let updatedInput;
  const settingsService = {
    authorize(value) {
      if (value !== 'Bearer correct-admin-token') {
        throw new SettingsError('UNAUTHORIZED', '管理口令无效。');
      }
    },
    overview: async (transport) => ({
      transport,
      localCredentials: {
        configured: true,
        healthy: true,
        lastLoadedAt: null,
        error: null,
        credentials: [],
      },
      providers: [],
      bindings: [],
      legacy: { detectedVariables: [], missingVariables: [], ready: false, importedAt: null },
    }),
    createProvider: async (input) => {
      createdInput = input;
      return localProvider;
    },
    updateProvider: async (_id, input) => {
      updatedInput = input;
      return { ...localProvider, ...input, id: providerId, revision: 2 };
    },
    saveBinding: async () => ({}),
    importLegacyConfiguration: async () => undefined,
  };
  return {
    app: createApp(
      { corsOrigins: ['http://localhost:8081'] },
      { settingsService, trustedProxyCidrs: [] },
    ),
    created: () => createdInput,
    updated: () => updatedInput,
  };
}

describe('settings routes', () => {
  it('reports test-adapter HTTP as an insecure remote connection', async () => {
    const { app } = settingsApp();
    const response = await app.request('/api/settings/transport-security');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      mode: 'insecure_remote_http',
      secretSubmissionAllowed: false,
      warning:
        '当前连接不是 HTTPS，不能通过此页面提交 Credential。请在服务器本地配置 credentials.yaml，然后选择对应的 Local Credential alias。',
    });
  });

  it('requires the management token for settings reads', async () => {
    const { app } = settingsApp();
    const response = await app.request('/api/settings');
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, 'UNAUTHORIZED');
  });

  it('rejects a nested Secret before provider parsing on insecure HTTP', async () => {
    const { app } = settingsApp();
    const response = await app.request('/api/settings/providers', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer correct-admin-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ nested: { apiKey: 'must-not-cross-http' } }),
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, 'INSECURE_CREDENTIAL_TRANSPORT');
  });

  it('rejects empty, batched and client-declared Secret fields on insecure HTTP', async () => {
    const { app } = settingsApp();
    for (const body of [
      { credential: {} },
      { items: [{ accessKeySecret: '' }] },
      { transport: { mode: 'https', secretSubmissionAllowed: true }, apiKey: '' },
    ]) {
      const response = await app.request('/api/settings/providers', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer correct-admin-token',
          'Content-Type': 'application/json',
          'X-Forwarded-Proto': 'https',
        },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 403);
      assert.equal((await response.json()).error.code, 'INSECURE_CREDENTIAL_TRANSPORT');
    }
  });

  it('allows a Local Credential alias and non-secret config on insecure HTTP', async () => {
    const { app, created } = settingsApp();
    const body = {
      type: 'deepseek',
      name: '本地 DeepSeek',
      config: { baseUrl: 'https://api.deepseek.com' },
      credentialSource: 'local_file',
      localCredentialAlias: 'deepseek-main',
    };
    const response = await app.request('/api/settings/providers', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer correct-admin-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 201);
    assert.deepEqual(created(), body);
    assert.deepEqual(await response.json(), localProvider);
  });

  it('allows updating ordinary fields of a Database Credential connection on insecure HTTP', async () => {
    const { app, updated } = settingsApp();
    const body = {
      type: 'deepseek',
      name: '更新后的 DeepSeek',
      config: { baseUrl: 'https://api.deepseek.com/v1' },
      credentialSource: 'database',
      expectedRevision: 1,
    };
    const response = await app.request(`/api/settings/providers/${providerId}`, {
      method: 'PUT',
      headers: {
        Authorization: 'Bearer correct-admin-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(updated(), body);
    assert.equal(Object.hasOwn(updated(), 'credential'), false);
  });
});
