/**
 * OSS 临时中转测试。
 *
 * 验证租户隔离对象键、24 小时签名地址与终态清理调用。
 *
 * Responsibilities:
 * - 防止临时供应商对象替代本地权威存储或使用可预测键。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { OssStagingStore } from '../../../dist/workspace/audio/transcription/ossStagingStore.js';

describe('OssStagingStore', () => {
  it('uploads under the revision prefix, signs for 24 hours and deletes the object', async () => {
    const calls = [];
    const client = {
      async put(name, file) {
        calls.push(['put', name, file]);
        return {};
      },
      signatureUrl(name, options) {
        calls.push(['signatureUrl', name, options]);
        return `https://oss.example/${name}`;
      },
      async delete(name) {
        calls.push(['delete', name]);
        return {};
      },
    };
    const store = new OssStagingStore(
      {
        region: 'oss-cn-beijing',
        bucket: 'echowave-staging',
        accessKeyId: 'id',
        accessKeySecret: 'secret',
        tenantId: 'tenant-1',
      },
      client,
    );
    const key = await store.upload('revision-1', 'C:\\audio\\whole.mp3');
    assert.match(key, /^echowave\/asr-staging\/tenant-1\/revision-1\/[0-9a-f-]+\.mp3$/);
    assert.equal(store.signedGetUrl(key), `https://oss.example/${key}`);
    await store.delete(key);
    assert.deepEqual(calls[1], ['signatureUrl', key, { expires: 86_400, method: 'GET' }]);
    assert.deepEqual(calls[2], ['delete', key]);
  });
});
