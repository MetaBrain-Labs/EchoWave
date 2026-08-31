/**
 * 知识库详情页面测试。
 *
 * 验证概览、文档、分组关联和跨页切组等主要行为。
 *
 * Responsibilities:
 * - 覆盖三标签页的数据展示与固定操作栏。
 * - 覆盖批量关联和切换分组确认。
 *
 * Notes:
 * - 服务端请求由 feature 级 mock 控制。
 */
import { fireEvent, render, waitFor, within } from '@testing-library/react-native';
import type { ComponentProps } from 'react';

import { KnowledgeDetailScreen } from '../KnowledgeDetailScreen';
import { getKnowledgeBase, listDocuments } from '../../apiClient';
import { document, knowledge } from '../../testing/fixtures';
import { linkKnowledgeBaseGroups, listKnowledgeBaseGroups } from '@/shared/api/knowledgeBasesApi';
import { listGroups } from '@/shared/api/groupsApi';
import { groupFixture } from '@/test/workspaceFixtures';

jest.mock('../../apiClient');
jest.mock('@/shared/api/knowledgeBasesApi');
jest.mock('@/shared/api/groupsApi');
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));

const secondGroup = {
  ...groupFixture,
  id: '10000000-0000-4000-8000-000000000002',
  name: '客户体验组',
};

async function renderDetail(props?: Partial<ComponentProps<typeof KnowledgeDetailScreen>>) {
  const screen = render(
    <KnowledgeDetailScreen
      knowledgeId={knowledge.id}
      onBack={jest.fn()}
      onOpenDocument={jest.fn()}
      {...props}
    />,
  );
  await screen.findByTestId('knowledge-overview-scroll');
  return screen;
}

describe('KnowledgeDetailScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getKnowledgeBase).mockResolvedValue(knowledge);
    jest.mocked(listDocuments).mockResolvedValue({ items: [document] });
    jest.mocked(listKnowledgeBaseGroups).mockResolvedValue({ items: [] });
    jest.mocked(listGroups).mockResolvedValue({ items: [groupFixture, secondGroup] });
    jest.mocked(linkKnowledgeBaseGroups).mockResolvedValue({ items: [groupFixture, secondGroup] });
  });

  it('opens on overview with server statistics, settings, and recent documents', async () => {
    const screen = await renderDetail();
    const overview = within(screen.getByTestId('knowledge-overview-scroll'));
    expect(overview.getByRole('tab', { name: '概览' }).props.accessibilityState).toEqual({
      selected: true,
    });
    expect(screen.getByText('1.0 KB')).toBeTruthy();
    expect(screen.getByText('检索增强（RAG）')).toBeTruthy();
    expect(screen.getByText('qwen3.7-text-embedding')).toBeTruthy();
    expect(screen.getByText('未启用')).toBeTruthy();
    expect(overview.getByText('用户研究执行计划')).toBeTruthy();
  });

  it('filters files and opens ready content', async () => {
    const onOpenDocument = jest.fn();
    const screen = await renderDetail({ onOpenDocument });
    fireEvent.press(
      within(screen.getByTestId('knowledge-overview-scroll')).getByRole('tab', { name: '库文件' }),
    );
    const files = within(screen.getByTestId('knowledge-files-scroll'));
    fireEvent.changeText(files.getByLabelText('搜索文档...'), '执行计划');
    fireEvent.press(files.getByLabelText('打开文件：用户研究执行计划'));
    expect(onOpenDocument).toHaveBeenCalledWith(document.id);
  });

  it('opens the grounded query page from the files action bar', async () => {
    const onAsk = jest.fn();
    const screen = await renderDetail({ onAsk });
    fireEvent.press(
      within(screen.getByTestId('knowledge-overview-scroll')).getByRole('tab', { name: '库文件' }),
    );
    fireEvent.press(screen.getByText('问知识库'));
    expect(onAsk).toHaveBeenCalled();
  });

  it('keeps linked groups disabled and batches new associations', async () => {
    jest.mocked(listKnowledgeBaseGroups).mockResolvedValue({ items: [groupFixture] });
    const screen = await renderDetail();
    fireEvent.press(
      within(screen.getByTestId('knowledge-overview-scroll')).getByRole('tab', {
        name: '关联分组',
      }),
    );
    fireEvent.press(screen.getByText('关联新分组'));

    const linked = await screen.findByLabelText(`已关联分组：${groupFixture.name}`);
    expect(linked.props.accessibilityState).toEqual({ checked: true, disabled: true });
    fireEvent.press(screen.getByLabelText(`选择分组：${secondGroup.name}`));
    fireEvent.press(screen.getByLabelText('确认关联所选分组'));

    await waitFor(() =>
      expect(linkKnowledgeBaseGroups).toHaveBeenCalledWith(knowledge.id, {
        groupIds: [secondGroup.id],
      }),
    );
    await waitFor(() => expect(screen.queryByLabelText('关闭分组选择抽屉')).toBeNull());
  });

  it('confirms switching to a linked group', async () => {
    jest.mocked(listKnowledgeBaseGroups).mockResolvedValue({ items: [groupFixture] });
    const onSwitchGroup = jest.fn();
    const screen = await renderDetail({ onSwitchGroup });
    fireEvent.press(
      within(screen.getByTestId('knowledge-overview-scroll')).getByRole('tab', {
        name: '关联分组',
      }),
    );
    fireEvent.press(screen.getByLabelText(`切换至分组：${groupFixture.name}`));
    expect(screen.getByText(`是否切换至“${groupFixture.name}”分组并返回主页面？`)).toBeTruthy();
    fireEvent.press(screen.getByLabelText('确认切换分组'));
    expect(onSwitchGroup).toHaveBeenCalledWith(groupFixture.id);
  });
});
