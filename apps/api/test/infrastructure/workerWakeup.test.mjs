/**
 * PostgreSQL Worker 唤醒总线测试。
 *
 * 验证固定 LISTEN 连接只分发当前 schema、租户和合法队列的提交后通知。
 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';

import {
  PostgresWorkerWakeup,
  WORKER_WAKEUP_CHANNEL,
} from '../../dist/infrastructure/workerWakeup.js';

const tenantId = '00000000-0000-4000-8000-000000000001';

class FakeClient extends EventEmitter {
  queries = [];
  released = [];

  async query(sql) {
    this.queries.push(sql);
    return { rows: [] };
  }

  release(destroy = false) {
    this.released.push(destroy);
  }
}

describe('PostgresWorkerWakeup', () => {
  it('filters notifications and releases the pinned connection on close', async () => {
    const client = new FakeClient();
    const wakeup = new PostgresWorkerWakeup({ connect: async () => client }, 'echowave', tenantId);
    await wakeup.start();

    let calls = 0;
    const unsubscribe = wakeup.subscribe('audio-transcription', () => {
      calls += 1;
    });
    const notify = (payload) =>
      client.emit('notification', {
        channel: WORKER_WAKEUP_CHANNEL,
        payload: JSON.stringify(payload),
      });

    notify({ schema: 'other', tenantId, queue: 'audio-transcription' });
    notify({ schema: 'echowave', tenantId: 'other', queue: 'audio-transcription' });
    notify({ schema: 'echowave', tenantId, queue: 'unknown' });
    notify({ schema: 'echowave', tenantId, queue: 'audio-transcription' });

    assert.equal(calls, 1);
    assert.deepEqual(client.queries, ['LISTEN "echowave_worker_jobs"']);
    unsubscribe();
    await wakeup.close();
    assert.deepEqual(client.queries, [
      'LISTEN "echowave_worker_jobs"',
      'UNLISTEN "echowave_worker_jobs"',
    ]);
    assert.deepEqual(client.released, [false]);
  });
});
