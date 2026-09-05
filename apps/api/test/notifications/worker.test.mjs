import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PushNotificationWorker } from '../../dist/notifications/worker.js';

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
});
