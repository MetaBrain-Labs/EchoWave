/**
 * 百炼端点解析测试。
 *
 * 验证新版 Workspace 配置与历史 URL revision 共享同一运行时解析边界。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  isDedicatedDashScopeConfig,
  resolveDashScopeEndpoints,
} from '../../dist/ai-runtime/dashScopeEndpoints.js';

describe('resolveDashScopeEndpoints', () => {
  const regions = [
    'cn-beijing',
    'ap-southeast-1',
    'ap-northeast-1',
    'eu-central-1',
    'cn-hongkong',
    'us-east-1',
  ];

  it('derives exact native and compatible URLs for every supported region', () => {
    for (const region of regions) {
      const origin = `https://llm-echowave.${region}.maas.aliyuncs.com`;
      assert.deepEqual(
        resolveDashScopeEndpoints({
          workspaceId: 'llm-echowave',
          region,
          asyncNotifyMode: 'polling',
          eventBridgeCallbackUrl: null,
        }),
        {
          origin,
          nativeBaseUrl: `${origin}/api/v1`,
          compatibleBaseUrl: `${origin}/compatible-mode/v1`,
          configurationMode: 'dedicated',
        },
      );
    }
  });

  it('derives native and compatible paths from the structured Workspace config', () => {
    assert.deepEqual(
      resolveDashScopeEndpoints({
        workspaceId: 'llm-echowave',
        region: 'ap-southeast-1',
        asyncNotifyMode: 'polling',
        eventBridgeCallbackUrl: null,
      }),
      {
        origin: 'https://llm-echowave.ap-southeast-1.maas.aliyuncs.com',
        nativeBaseUrl: 'https://llm-echowave.ap-southeast-1.maas.aliyuncs.com/api/v1',
        compatibleBaseUrl:
          'https://llm-echowave.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
        configurationMode: 'dedicated',
      },
    );
  });

  it('keeps historical URL revisions readable while ignoring their rerank override', () => {
    const config = {
      baseUrl: 'https://dashscope.aliyuncs.com/api/v1/',
      compatibleBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/',
      rerankBaseUrl: 'https://wrong.example.com/api/v1',
      asyncNotifyMode: 'polling',
      eventBridgeCallbackUrl: null,
    };
    assert.equal(isDedicatedDashScopeConfig(config), false);
    assert.deepEqual(resolveDashScopeEndpoints(config), {
      origin: 'https://dashscope.aliyuncs.com',
      nativeBaseUrl: 'https://dashscope.aliyuncs.com/api/v1',
      compatibleBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      configurationMode: 'legacy',
    });
  });
});
