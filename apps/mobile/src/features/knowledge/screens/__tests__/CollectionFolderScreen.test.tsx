/**
 * 历史文件夹整理交互测试。
 *
 * Responsibilities:
 * - 验证按来源分组选择同库规则与版本化批量归类。
 * - 失败保留选择、搜索与正文导航。
 * Notes:
 * - 使用真实共享抽屉与刷新控件，不触发解析。
 */
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { CollectionFolderScreen } from '../CollectionFolderScreen';
import { getCollectionFolder, organizeCollectionCases } from '@/shared/api/collectionFoldersApi';
import { listCollectionRules } from '@/shared/api/collectionApi';
import { listGroups } from '@/shared/api/groupsApi';
import { listDocuments } from '../../apiClient';
import { knowledge, document } from '../../testing/fixtures';
import { groupFixture } from '@/test/workspaceFixtures';
jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));
jest.mock('@/shared/api/collectionFoldersApi');
jest.mock('@/shared/api/collectionApi');
jest.mock('@/shared/api/groupsApi');
jest.mock('../../apiClient');
const id = '11111111-1111-4111-8111-111111111111';
const folder = {
  id,
  knowledgeBaseId: knowledge.id,
  kind: 'legacy' as const,
  name: '历史收集',
  ruleId: null,
  groupId: null,
  caseCount: 1,
  updatedAt: document.updatedAt,
};
beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(getCollectionFolder)
    .mockResolvedValue({
      folder,
      items: [
        {
          caseId: id,
          documentId: document.id,
          groupId: groupFixture.id,
          title: document.title,
          version: 3,
        },
      ],
    });
  jest.mocked(listDocuments).mockResolvedValue({ items: [{ ...document, caseId: id }] });
  jest.mocked(listGroups).mockResolvedValue({ items: [groupFixture] });
  jest.mocked(listCollectionRules).mockResolvedValue({
    items: [
      {
        id,
        groupId: groupFixture.id,
        version: 1,
        updatedAt: document.updatedAt,
        name: '已有收集规则',
        enabled: true,
        mode: 'review',
        knowledgeBaseId: knowledge.id,
        category: { id: 'strength', name: '优点' },
        filters: {
          sources: ['strength'],
          dataSourceIds: [],
          customLabels: [],
          keywords: [],
          minimumConfidence: null,
        },
      },
    ],
  });
});
test('historical organizing sends current versions and retains failed selections', async () => {
  jest
    .mocked(organizeCollectionCases)
    .mockResolvedValue({ items: [{ id, success: false, message: '冲突' }] });
  const screen = render(
    <CollectionFolderScreen
      knowledgeId={knowledge.id}
      folderId={id}
      organizing
      onBack={jest.fn()}
      onOpenCase={jest.fn()}
      onViewRule={jest.fn()}
      onOrganize={jest.fn()}
    />,
  );
  fireEvent.press(await screen.findByRole('radio', { name: groupFixture.name }));
  fireEvent.press(await screen.findByRole('radio', { name: '已有收集规则' }));
  fireEvent.press(screen.getByRole('checkbox', { name: `选择案例：${document.title}` }));
  fireEvent.press(screen.getByRole('button', { name: /^整理案例/ }));
  await waitFor(() =>
    expect(organizeCollectionCases).toHaveBeenCalledWith(knowledge.id, id, {
      ruleId: id,
      items: [{ id, expectedVersion: 3 }],
    }),
  );
  await screen.findByText(/未完成/);
  expect(
    screen.getByRole('checkbox', { name: `选择案例：${document.title}` }).props.accessibilityState
      .checked,
  ).toBe(true);
});
test('folder retains incoming document search and document body opens its case', async () => {
  const open = jest.fn();
  const screen = render(
    <CollectionFolderScreen
      knowledgeId={knowledge.id}
      folderId={id}
      initialQuery="执行计划"
      onBack={jest.fn()}
      onOpenCase={open}
      onViewRule={jest.fn()}
      onOrganize={jest.fn()}
    />,
  );
  fireEvent.press(await screen.findByLabelText(`打开文件：${document.title}`));
  expect(open).toHaveBeenCalledWith(id);
  expect(screen.getByLabelText('搜索案例或类别').props.value).toBe('执行计划');
});
