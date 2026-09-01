/**
 * 分组页面本地查询模型测试。
 *
 * 验证共享查询、音频多状态筛选和创建时间排序的组合语义。
 *
 * Responsibilities:
 * - 锁定三个标签的中文搜索字段。
 * - 锁定空状态集合与排序默认值。
 */
import { audioFixtures, knowledgeFixtures, sourceFixtures } from '@/test/workspaceFixtures';
import {
  selectAudioItems,
  selectDataSources,
  selectKnowledgeBases,
  type AudioStatusKind,
} from '../model';

describe('group local query model', () => {
  it('uses one query across audio, knowledge bases, and data sources', () => {
    expect(selectAudioItems(audioFixtures, '上传中', new Set(), 'newest')).toHaveLength(2);
    expect(selectKnowledgeBases(knowledgeFixtures, '研究资料').map((item) => item.name)).toEqual([
      '产品研究知识库',
    ]);
    expect(selectDataSources(sourceFixtures, '已连接')).toHaveLength(4);
  });

  it('combines multi-status filtering with newest and oldest ordering', () => {
    const statuses = new Set<AudioStatusKind>(['ready', 'failed']);
    const newest = selectAudioItems(audioFixtures, '', statuses, 'newest');
    const oldest = selectAudioItems(audioFixtures, '', statuses, 'oldest');

    expect(newest.map((item) => item.status.kind)).toEqual(['ready', 'ready', 'failed', 'failed']);
    expect(oldest.map((item) => item.id)).toEqual([
      audioFixtures[8].id,
      audioFixtures[5].id,
      audioFixtures[0].id,
      audioFixtures[1].id,
    ]);
    expect(selectAudioItems(audioFixtures, '', new Set(), 'newest')).toHaveLength(
      audioFixtures.length,
    );
  });

  it('sorts and filters knowledge bases by update time and document presence', () => {
    const emptyKnowledge = {
      ...knowledgeFixtures[0],
      id: 'b0000000-0000-4000-8000-000000000099',
      name: '空知识库',
      documentCount: 0,
      updatedAt: '2026-08-21T00:00:00.000Z',
    };

    expect(
      selectKnowledgeBases([...knowledgeFixtures, emptyKnowledge], '', 'newest', 'empty').map(
        (item) => item.name,
      ),
    ).toEqual(['空知识库']);
    expect(selectKnowledgeBases([...knowledgeFixtures, emptyKnowledge], '', 'newest')[0].name).toBe(
      '空知识库',
    );
  });

  it('searches Chinese source metadata and keeps never-uploaded sources last', () => {
    const neverUploaded = {
      ...sourceFixtures[0],
      id: '20000000-0000-4000-8000-000000000099',
      name: '从未上传',
      lastUploadedAt: null,
    };

    expect(selectDataSources(sourceFixtures, '云端')).toHaveLength(2);
    expect(
      selectDataSources(
        [...sourceFixtures, neverUploaded],
        '',
        'oldest',
        new Set(['local']),
        new Set(['connected']),
      ).at(-1)?.name,
    ).toBe('从未上传');
  });
});
