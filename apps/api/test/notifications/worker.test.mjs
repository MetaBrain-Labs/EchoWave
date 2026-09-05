import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PushNotificationWorker } from '../../dist/notifications/worker.js';

const delivery = {
  id: '20000000-0000-4000-8000-000000000001',
  deviceId: '10000000-0000-4000-8000-000000000001',
  token: 'ExponentPushToken[abcdefghijklmnopqrstuvwxyz]',
  attemptCount: 1,
  ticketId: null,
  title: '分析完成',
  body: '批次已完成',
  eventType: 'COMPLETED',
  batchId: '30000000-0000-4000-8000-000000000001',
  taskId: null,
};

function repositoryFor(claimedDelivery = delivery) {
  const calls = [];
  return {
    calls,
    repository: {
      claim: async () => claimedDelivery,
      disableDevice: async (...args) => calls.push(['disableDevice', ...args]),
      markDelivered: async (...args) => calls.push(['markDelivered', ...args]),
      markFailed: async (...args) => calls.push(['markFailed', ...args]),
      markTicketed: async (...args) => calls.push(['markTicketed', ...args]),
      retryOrFail: async (...args) => calls.push(['retryOrFail', ...args]),
    },
  };
}

describe('PushNotificationWorker', () => {
  it('does not claim deliveries when remote push is disabled', async () => {
    let claims = 0;
    const worker = new PushNotificationWorker({
      enabled: false,
      repository: {
        claim: async () => {
          claims += 1;
          return undefined;
        },
      },
    });

    await worker.start();
    await worker.stop();

    assert.equal(claims, 0);
  });

  it('persists a successful Expo ticket without logging the token', async () => {
    const { calls, repository } = repositoryFor();
    const worker = new PushNotificationWorker({
      repository,
      expo: {
        sendPushNotificationsAsync: async () => [{ status: 'ok', id: 'ticket-1' }],
      },
    });

    await worker.runOne();

    assert.deepEqual(calls, [['markTicketed', delivery.id, 'ticket-1']]);
  });

  it('persists a successful receipt', async () => {
    const ticketed = { ...delivery, ticketId: 'ticket-1' };
    const { calls, repository } = repositoryFor(ticketed);
    const worker = new PushNotificationWorker({
      repository,
      expo: {
        getPushNotificationReceiptsAsync: async () => ({ 'ticket-1': { status: 'ok' } }),
      },
    });

    await worker.runOne();

    assert.deepEqual(calls, [['markDelivered', delivery.id]]);
  });

  it('keeps permanent FCM credential and sender errors diagnosable', async () => {
    for (const code of ['InvalidCredentials', 'MismatchSenderId']) {
      const { calls, repository } = repositoryFor();
      const worker = new PushNotificationWorker({
        repository,
        expo: {
          sendPushNotificationsAsync: async () => [
            { status: 'error', message: `provider rejected: ${code}`, details: { error: code } },
          ],
        },
      });

      await worker.runOne();

      assert.deepEqual(calls, [['markFailed', delivery.id, code, `provider rejected: ${code}`]]);
    }
  });

  it('disables a device when its receipt reports DeviceNotRegistered', async () => {
    const ticketed = { ...delivery, ticketId: 'ticket-1' };
    const { calls, repository } = repositoryFor(ticketed);
    const worker = new PushNotificationWorker({
      repository,
      expo: {
        getPushNotificationReceiptsAsync: async () => ({
          'ticket-1': {
            status: 'error',
            message: 'device removed the app',
            details: { error: 'DeviceNotRegistered' },
          },
        }),
      },
    });

    await worker.runOne();

    assert.deepEqual(calls, [
      ['disableDevice', delivery.deviceId],
      ['markFailed', delivery.id, 'DeviceNotRegistered', 'device removed the app'],
    ]);
  });

  it('retries network failures after removing a token from the persisted message', async () => {
    const { calls, repository } = repositoryFor();
    const worker = new PushNotificationWorker({
      repository,
      expo: {
        sendPushNotificationsAsync: async () => {
          throw new Error(`failed ${delivery.token}`);
        },
      },
    });

    await worker.runOne();

    assert.equal(calls[0][0], 'retryOrFail');
    assert.equal(calls[0][2], 'PUSH_NETWORK_ERROR');
    assert.equal(calls[0][3], 'failed [REDACTED_PUSH_TOKEN]');
  });
});
