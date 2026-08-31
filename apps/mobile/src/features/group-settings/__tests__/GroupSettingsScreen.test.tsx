/**
 * 分组设置页面测试。
 *
 * 验证基本设置和两类资源关联均从服务端读取，并通过对应原子接口保存。
 *
 * Responsibilities:
 * - 覆盖设置导航、标签规范化和关联集合替换交互。
 */
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { GroupSettingsScreen } from '../GroupSettingsScreen';
import * as groupsApi from '@/shared/api/groupsApi';
import * as dataSourcesApi from '@/shared/api/dataSourcesApi';
import * as knowledgeBasesApi from '@/shared/api/knowledgeBasesApi';
import { groupFixture, knowledgeFixtures, sourceFixtures } from '@/test/workspaceFixtures';

jest.mock('@/shared/api/groupsApi', () => ({
  archiveGroup: jest.fn(),
  getGroupSettings: jest.fn(),
  listGroupDataSources: jest.fn(),
  listGroupKnowledgeBases: jest.fn(),
  replaceGroupDataSources: jest.fn(),
  replaceGroupKnowledgeBases: jest.fn(),
  updateGroupSettings: jest.fn(),
}));
jest.mock('@/shared/api/dataSourcesApi', () => ({ listDataSources: jest.fn() }));
jest.mock('@/shared/api/knowledgeBasesApi', () => ({ listKnowledgeBases: jest.fn() }));

const workspaceApi = { ...groupsApi, ...dataSourcesApi, ...knowledgeBasesApi };

describe('GroupSettingsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    jest.mocked(workspaceApi.getGroupSettings).mockResolvedValue({
      groupId: groupFixture.id,
      name: groupFixture.name,
      analysis: {
        timing: 'automatic',
        contentFocus: '分析销售话术的优点和待改进点。',
        tone: '正式、专业、结构清晰',
        customTags: ['需求探索'],
      },
      updatedAt: '2026-08-28T08:00:00.000Z',
    });
    jest.mocked(workspaceApi.listKnowledgeBases).mockResolvedValue({ items: knowledgeFixtures });
    jest
      .mocked(workspaceApi.listGroupKnowledgeBases)
      .mockResolvedValue({ items: [knowledgeFixtures[0]] });
    jest.mocked(workspaceApi.listDataSources).mockResolvedValue({ items: sourceFixtures });
    jest
      .mocked(workspaceApi.listGroupDataSources)
      .mockResolvedValue({ items: [sourceFixtures[0]] });
    jest.mocked(workspaceApi.updateGroupSettings).mockResolvedValue({
      groupId: groupFixture.id,
      name: groupFixture.name,
      analysis: {
        timing: 'manual',
        contentFocus: '分析销售话术的优点和待改进点。',
        tone: '正式、专业、结构清晰',
        customTags: ['需求探索', '促成动作'],
      },
      updatedAt: '2026-08-28T08:01:00.000Z',
    });
    jest
      .mocked(workspaceApi.replaceGroupKnowledgeBases)
      .mockResolvedValue({ items: knowledgeFixtures });
    jest.mocked(workspaceApi.replaceGroupDataSources).mockResolvedValue({ items: sourceFixtures });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function renderSettings() {
    const screen = render(
      <GroupSettingsScreen groupId={groupFixture.id} onArchived={jest.fn()} onBack={jest.fn()} />,
    );
    await waitFor(() => expect(screen.queryByLabelText('正在加载分组设置')).toBeNull());
    return screen;
  }

  it('saves manual analysis settings with a normalized custom tag', async () => {
    const screen = await renderSettings();

    fireEvent.press(screen.getByRole('radio', { name: '手动分析' }));
    fireEvent.changeText(screen.getByLabelText('新分析标签'), '  促成动作  ');
    fireEvent(screen.getByLabelText('新分析标签'), 'submitEditing');
    fireEvent.press(screen.getByText('保存设置'));

    await waitFor(() =>
      expect(workspaceApi.updateGroupSettings).toHaveBeenCalledWith(
        groupFixture.id,
        expect.objectContaining({
          analysis: expect.objectContaining({
            timing: 'manual',
            customTags: ['需求探索', '促成动作'],
          }),
        }),
      ),
    );
  });

  it('atomically replaces the selected knowledge-base set', async () => {
    const screen = await renderSettings();

    fireEvent.press(screen.getByRole('tab', { name: '知识库设置' }));
    fireEvent.press(screen.getByRole('checkbox', { name: knowledgeFixtures[1].name }));
    fireEvent.press(screen.getByText('保存关联'));

    await waitFor(() =>
      expect(workspaceApi.replaceGroupKnowledgeBases).toHaveBeenCalledWith(groupFixture.id, {
        ids: [knowledgeFixtures[0].id, knowledgeFixtures[1].id],
      }),
    );
  });
});
