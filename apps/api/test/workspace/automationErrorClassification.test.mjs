/**
 * 自动分析供应商错误分类测试。
 *
 * 验证明确信号进入硬阻塞，普通限流和网络错误不会误触发用户推送。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  classifyHardBlock,
  classifyStoredHardBlock,
} from '../../dist/workspace/audio/automation/errorClassification.js';
import { SettingsError } from '../../dist/settings/types.js';

describe('automation provider error classification', () => {
  it('does not infer quota exhaustion from an ordinary HTTP 429', () => {
    assert.equal(classifyStoredHardBlock('HTTP_429', 'Too many requests'), null);
    assert.equal(classifyHardBlock(new Error('network timeout')), null);
  });

  it('recognizes explicit quota, credentials and missing configuration', () => {
    assert.equal(
      classifyStoredHardBlock('HTTP_429', 'Account quota exhausted')?.reason,
      'API_QUOTA_EXCEEDED',
    );
    assert.equal(classifyStoredHardBlock('AUTH', 'Invalid API key')?.reason, 'INVALID_CREDENTIALS');
    assert.equal(
      classifyHardBlock(new SettingsError('CONFIGURATION_REQUIRED', '未配置'))?.reason,
      'CONFIGURATION_REQUIRED',
    );
  });
});
