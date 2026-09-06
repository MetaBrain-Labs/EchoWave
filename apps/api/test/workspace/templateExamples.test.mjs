/**
 * 起步模板只读分析示例测试。
 *
 * 验证两份产品目录内容及普通、归档分组的拒绝边界。
 *
 * Responsibilities:
 * - 校验示例始终通过共享契约。
 * - 确保示例查询不会依赖或写入音频分析表。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TemplateExampleSchema } from '@echowave/contracts';

import { DefaultGroupService } from '../../dist/workspace/groups/service.js';
import { getStarterTemplateExample } from '../../dist/workspace/starter-templates/catalog.js';
import { WorkspaceRepositoryError } from '../../dist/workspace/errors.js';

const groupId = '11111111-1111-4111-8111-111111111111';

describe('starter template examples', () => {
  it('publishes one valid example for each starter template', () => {
    for (const key of ['sales_call_review', 'personal_speaking_coach']) {
      const example = TemplateExampleSchema.parse(getStarterTemplateExample(key));
      assert.equal(example.templateKey, key);
      assert.equal(example.playbackAvailable, false);
      assert.ok(example.analysisTags.every((tag) => tag.evidenceSegmentIds.length > 0));
    }
  });

  it('returns the catalog example only for an active template group', async () => {
    const service = new DefaultGroupService({
      getGroup: async () => ({ id: groupId, starterTemplateKey: 'sales_call_review' }),
    });
    assert.equal((await service.getTemplateExample(groupId)).templateKey, 'sales_call_review');
  });

  it('rejects ordinary and archived groups as not found', async () => {
    const ordinary = new DefaultGroupService({
      getGroup: async () => ({ id: groupId, starterTemplateKey: null }),
    });
    await assert.rejects(
      () => ordinary.getTemplateExample(groupId),
      (error) => error instanceof WorkspaceRepositoryError && error.code === 'NOT_FOUND',
    );

    const archived = new DefaultGroupService({
      getGroup: async () => {
        throw new WorkspaceRepositoryError('NOT_FOUND', '分组不存在。');
      },
    });
    await assert.rejects(
      () => archived.getTemplateExample(groupId),
      (error) => error instanceof WorkspaceRepositoryError && error.code === 'NOT_FOUND',
    );
  });
});
