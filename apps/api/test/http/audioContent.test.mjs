/**
 * 音频内容 Range 解析测试。
 *
 * 验证完整响应、三种单区间形式和不可满足范围的稳定边界。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveAudioByteRange } from '../../dist/http/audioContent.js';

describe('resolveAudioByteRange', () => {
  it('resolves full, bounded, open-ended, and suffix requests', () => {
    assert.deepEqual(resolveAudioByteRange(undefined, 10), { kind: 'full', start: 0, end: 9 });
    assert.deepEqual(resolveAudioByteRange('bytes=2-5', 10), {
      kind: 'partial',
      start: 2,
      end: 5,
    });
    assert.deepEqual(resolveAudioByteRange('bytes=7-', 10), {
      kind: 'partial',
      start: 7,
      end: 9,
    });
    assert.deepEqual(resolveAudioByteRange('bytes=-4', 10), {
      kind: 'partial',
      start: 6,
      end: 9,
    });
  });

  it('rejects invalid, multiple, empty, and out-of-bounds ranges', () => {
    for (const range of ['bytes=', 'items=0-1', 'bytes=8-2', 'bytes=10-', 'bytes=0-1,4-5']) {
      assert.deepEqual(resolveAudioByteRange(range, 10), { kind: 'unsatisfiable' });
    }
    assert.deepEqual(resolveAudioByteRange(undefined, 0), { kind: 'unsatisfiable' });
  });
});
