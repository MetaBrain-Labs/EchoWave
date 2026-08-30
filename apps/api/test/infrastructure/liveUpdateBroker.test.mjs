/**
 * 实时状态事件总线测试。
 *
 * 验证资源过滤、未消费信号合并与连接释放边界。
 *
 * Responsibilities:
 * - 锁定单实例 SSE 唤醒器的有界行为。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { LiveUpdateBroker } from '../../dist/infrastructure/liveUpdateBroker.js';

describe('LiveUpdateBroker', () => {
  it('filters resources, coalesces duplicates, and retains distinct pending resources', async () => {
    const broker = new LiveUpdateBroker();
    const subscription = broker.subscribe(
      (event) => event.kind === 'data-source-audio' && event.dataSourceId === 'source-1',
    );
    broker.publish({
      kind: 'data-source-audio',
      dataSourceId: 'source-2',
      audioFileId: 'ignored',
      terminal: false,
    });
    broker.publish({
      kind: 'data-source-audio',
      dataSourceId: 'source-1',
      audioFileId: 'audio-1',
      terminal: false,
    });
    broker.publish({
      kind: 'data-source-audio',
      dataSourceId: 'source-1',
      audioFileId: 'audio-1',
      terminal: true,
    });
    broker.publish({
      kind: 'data-source-audio',
      dataSourceId: 'source-1',
      audioFileId: 'audio-2',
      terminal: false,
    });

    assert.deepEqual(await subscription.wait(10), {
      kind: 'data-source-audio',
      dataSourceId: 'source-1',
      audioFileId: 'audio-1',
      terminal: true,
    });
    assert.deepEqual(await subscription.wait(10), {
      kind: 'data-source-audio',
      dataSourceId: 'source-1',
      audioFileId: 'audio-2',
      terminal: false,
    });
    subscription.close();
    assert.equal(await subscription.wait(10), undefined);
  });
});
