/**
 * 收集分组选择交互测试。
 *
 * Responsibilities:
 * - 验证关联优先、搜索、明确选择和请求失败重试。
 *
 * Notes:
 * - 不连接真实工作区。
 */
import { RefreshControl } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { CollectionGroupsScreen } from '../CollectionGroupsScreen';
import { listGroups } from '@/shared/api/groupsApi';
import { listKnowledgeBaseGroups } from '@/shared/api/knowledgeBasesApi';
import { groupFixture } from '@/test/workspaceFixtures';
jest.mock('@/shared/api/groupsApi');
jest.mock('@/shared/hooks/useScreenRefresh', () => ({
  useScreenRefresh: (refresh: () => Promise<void>) => ({
    refreshing: false,
    onRefresh: () => void refresh(),
  }),
}));
jest.mock('@/shared/api/knowledgeBasesApi');
const other = { ...groupFixture, id: '22222222-2222-4222-8222-222222222222', name: '其他分组' };
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(listGroups).mockResolvedValue({ items: [other, groupFixture] });
  jest.mocked(listKnowledgeBaseGroups).mockResolvedValue({ items: [groupFixture] });
});
test('associated groups are shown first without selecting automatically', async () => {
  const onSelect = jest.fn();
  const screen = render(
    <CollectionGroupsScreen defaultKnowledgeId="library" onBack={jest.fn()} onSelect={onSelect} />,
  );
  await screen.findByRole('button', { name: groupFixture.name });
  const groupButtons = screen
    .getAllByRole('button')
    .filter((button) => [groupFixture.name, other.name].includes(button.props.accessibilityLabel));
  expect(groupButtons[0].props.accessibilityLabel).toBe(groupFixture.name);
  expect(onSelect).not.toHaveBeenCalled();
  fireEvent.changeText(screen.getByLabelText('搜索分组'), '不存在');
  expect(screen.getByText('没有匹配结果')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: '清空搜索' }));
  fireEvent.press(screen.getByRole('button', { name: other.name }));
  expect(onSelect).toHaveBeenCalledWith(other.id);
});
test('failed loading retains search and retries', async () => {
  jest.mocked(listGroups).mockRejectedValueOnce(new Error('timeout'));
  const screen = render(<CollectionGroupsScreen onBack={jest.fn()} onSelect={jest.fn()} />);
  await screen.findByText(/无法加载收集信息/);
  fireEvent.changeText(screen.getByLabelText('搜索分组'), '其他');
  fireEvent(screen.UNSAFE_getByType(RefreshControl), 'refresh');
  await screen.findByRole('button', { name: other.name });
  expect(screen.queryByRole('button', { name: groupFixture.name })).toBeNull();
  expect(screen.getByLabelText('搜索分组').props.value).toBe('其他');
});
test('an unavailable library does not prevent explicit group selection', async () => {
  jest.mocked(listKnowledgeBaseGroups).mockRejectedValue(new Error('not found'));
  const onSelect = jest.fn();
  const screen = render(
    <CollectionGroupsScreen defaultKnowledgeId="missing" onBack={jest.fn()} onSelect={onSelect} />,
  );
  await screen.findByText(/当前目标知识库已删除或不可用/);
  fireEvent.press(screen.getByRole('button', { name: other.name }));
  expect(onSelect).toHaveBeenCalledWith(other.id);
});
