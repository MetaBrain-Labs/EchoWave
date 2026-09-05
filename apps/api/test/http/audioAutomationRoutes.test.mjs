/**
 * 自动分析与推送设备 HTTP 路由测试。
 *
 * 验证共享契约解析、恢复/取消路由和 Token 登记信任边界。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createApp } from '../../dist/http/app.js';

const id = '11111111-1111-4111-8111-111111111111';

describe('audio automation routes', () => {
  it('routes validated batch commands', async () => {
    const calls = [];
    const app = createApp(
      { corsOrigins: ['http://localhost:8081'] },
      {
        audioAutomationService: {
          create: async (input) => {
            calls.push(['create', input]);
            return { accepted: true };
          },
          resumeBatch: async (batchId) => {
            calls.push(['resume', batchId]);
            return { resumedTaskIds: [] };
          },
          cancelTask: async (taskId) => {
            calls.push(['cancel', taskId]);
            return { canceledTaskIds: [] };
          },
        },
      },
    );
    const created = await app.request('/api/audio-analysis-batches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'existing_audio',
        dataSourceId: id,
        groupId: id,
        audioFileIds: [id],
      }),
    });
    assert.equal(created.status, 201);
    assert.equal((await created.json()).accepted, true);
    assert.equal(
      (await app.request(`/api/audio-analysis-batches/${id}/resume`, { method: 'POST' })).status,
      200,
    );
    assert.equal(
      (await app.request(`/api/audio-analysis-tasks/${id}`, { method: 'DELETE' })).status,
      200,
    );
    assert.deepEqual(
      calls.map((call) => call[0]),
      ['create', 'resume', 'cancel'],
    );
  });

  it('registers and disables a validated Expo Push Token', async () => {
    const calls = [];
    const app = createApp(
      { corsOrigins: ['http://localhost:8081'] },
      {
        pushDeviceService: {
          register: async (input) => {
            calls.push(['register', input.token]);
            return {
              id,
              platform: input.platform,
              enabled: true,
              updatedAt: new Date().toISOString(),
            };
          },
          disable: async (input) => calls.push(['disable', input.token]),
        },
      },
    );
    const token = 'ExponentPushToken[abc_123-XYZ]';
    assert.equal(
      (
        await app.request('/api/push-devices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, platform: 'android' }),
        })
      ).status,
      201,
    );
    assert.equal(
      (
        await app.request('/api/push-devices', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        })
      ).status,
      204,
    );
    assert.deepEqual(calls, [
      ['register', token],
      ['disable', token],
    ]);
  });
});
