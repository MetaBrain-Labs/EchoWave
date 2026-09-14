/**
 * 收集规则表单交互回归。
 *
 * Responsibilities:
 * - 验证折叠搜索、默认目标、失败保留和未保存保护。
 *
 * Notes:
 * - 不调用真实接口。
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { usePreventRemove } from 'expo-router/react-navigation';
import { Alert, RefreshControl, StyleSheet } from 'react-native';
import type { CollectionRule } from '@echowave/contracts';
import { CollectionRulesScreen } from '../CollectionRulesScreen';
import {
  listCollectionRules,
  listCollectionRuns,
  saveCollectionRule,
} from '@/shared/api/collectionApi';
import { listKnowledgeBases } from '@/shared/api/knowledgeBasesApi';
import { getGroup, listGroupDataSources } from '@/shared/api/groupsApi';
import { knowledge } from '@/features/knowledge/testing/fixtures';
import { sourceFixtures } from '@/test/workspaceFixtures';
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }));
jest.mock('@/shared/api/collectionApi');
jest.mock('@/shared/hooks/useScreenRefresh', () => ({
  useScreenRefresh: (refresh: () => Promise<void>) => ({
    refreshing: false,
    onRefresh: () => void refresh(),
  }),
}));
jest.mock('@/shared/api/knowledgeBasesApi');
jest.mock('@/shared/api/groupsApi');
const dataSourceFixture = sourceFixtures[0]!;
const groupId = '11111111-1111-4111-8111-111111111111';
const other = { ...knowledge, id: '22222222-2222-4222-8222-222222222222', name: '其他知识库' };
const rule: CollectionRule = {
  id: groupId,
  groupId,
  version: 1,
  updatedAt: '2026-09-14T00:00:00Z',
  name: '现有规则',
  enabled: true,
  mode: 'direct',
  knowledgeBaseId: other.id,
  category: { id: 'strength', name: '优点' },
  filters: {
    sources: ['strength'],
    customLabels: [],
    keywords: [],
    minimumConfidence: null,
    dataSourceIds: [],
  },
};
beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(getGroup)
    .mockResolvedValue({ name: '服务器当前分组' } as Awaited<ReturnType<typeof getGroup>>);
  jest.mocked(listCollectionRules).mockResolvedValue({ items: [] });
  jest.mocked(listCollectionRuns).mockResolvedValue({ items: [] });
  jest.mocked(listKnowledgeBases).mockResolvedValue({ items: [knowledge, other] });
  jest.mocked(listGroupDataSources).mockResolvedValue({ items: [dataSourceFixture] });
});
async function openNew() {
  const screen = render(
    <CollectionRulesScreen
      groupId={groupId}
      defaultKnowledgeId={knowledge.id}
      onBack={jest.fn()}
    />,
  );
  await screen.findByText('暂无收集规则，新增规则开始设置。');
  expect(screen.queryByLabelText('规则名称')).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: '新增收集规则' }));
  return screen;
}
test('collapsed searchable selectors preserve hidden selections and default target', async () => {
  jest.mocked(saveCollectionRule).mockRejectedValue(new Error('network'));
  const screen = await openNew();
  expect(screen.queryByRole('radio', { name: other.name })).toBeNull();
  expect(screen.queryByRole('checkbox', { name: dataSourceFixture.name })).toBeNull();
  expect(screen.getByRole('button', { name: '目标知识库' })).toHaveProp('accessibilityState', {
    expanded: false,
  });
  fireEvent.press(screen.getByRole('button', { name: '目标知识库' }));
  expect(screen.getByRole('radio', { name: knowledge.name })).toHaveProp('accessibilityState', {
    checked: true,
  });
  fireEvent.changeText(screen.getByLabelText('目标知识库 · 搜索名称'), '不存在');
  expect(screen.getByText('没有匹配结果')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: '清空搜索' }));
  expect(screen.getByRole('radio', { name: knowledge.name })).toHaveProp('accessibilityState', {
    checked: true,
  });
  fireEvent.press(screen.getByRole('button', { name: '来源数据源' }));
  fireEvent.press(screen.getByRole('checkbox', { name: dataSourceFixture.name }));
  fireEvent.changeText(screen.getByLabelText('来源数据源 · 搜索名称'), '不存在');
  fireEvent.changeText(screen.getByLabelText('规则名称'), '新规则');
  fireEvent.press(screen.getByRole('button', { name: '保存规则' }));
  await screen.findByText(/保存未完成/);
  expect(screen.getByLabelText('规则名称').props.value).toBe('新规则');
  fireEvent(screen.UNSAFE_getByType(RefreshControl), 'refresh');
  await waitFor(() => expect(listCollectionRules).toHaveBeenCalledTimes(2));
  expect(screen.getByLabelText('规则名称').props.value).toBe('新规则');
  expect(saveCollectionRule).toHaveBeenCalledWith(
    groupId,
    expect.objectContaining({
      knowledgeBaseId: knowledge.id,
      mode: 'review',
      filters: expect.objectContaining({ dataSourceIds: [dataSourceFixture.id] }),
    }),
    undefined,
  );
});
test('editing keeps the saved target and discard confirmation protects group switching', async () => {
  jest.mocked(listCollectionRules).mockResolvedValue({ items: [rule] });
  const onSwitchGroup = jest.fn();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const screen = render(
    <CollectionRulesScreen
      groupId={groupId}
      defaultKnowledgeId={knowledge.id}
      onBack={jest.fn()}
      onSwitchGroup={onSwitchGroup}
    />,
  );
  fireEvent.press(await screen.findByRole('button', { name: /现有规则/ }));
  fireEvent.press(screen.getByRole('button', { name: '目标知识库' }));
  expect(screen.getByRole('radio', { name: other.name })).toHaveProp('accessibilityState', {
    checked: true,
  });
  fireEvent.changeText(screen.getByLabelText('规则名称'), '未保存修改');
  fireEvent.press(screen.getByRole('button', { name: '切换分组' }));
  expect(onSwitchGroup).not.toHaveBeenCalled();
  expect(alert).toHaveBeenCalledWith('编辑尚未保存', expect.any(String), expect.any(Array));
  act(() => {
    alert.mock.calls
      .at(-1)?.[2]
      ?.find((button) => button.style === 'destructive')
      ?.onPress?.();
  });
  await waitFor(() => expect(onSwitchGroup).toHaveBeenCalledTimes(1));
  expect(screen.queryByLabelText('规则名称')).toBeNull();
  alert.mockRestore();
});
test('navigation removal waits for explicit discard of an unsaved rule', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const dispatch = jest.fn();
  const screen = render(
    <CollectionRulesScreen groupId={groupId} onBack={jest.fn()} navigation={{ dispatch }} />,
  );
  await screen.findByText('暂无收集规则，新增规则开始设置。');
  fireEvent.press(screen.getByRole('button', { name: '新增收集规则' }));
  fireEvent.changeText(screen.getByLabelText('规则名称'), '未保存');
  const guard = jest.mocked(usePreventRemove).mock.calls.at(-1)!;
  expect(guard[0]).toBe(true);
  act(() => guard[1]({ data: { action: { type: 'GO_BACK' } } }));
  expect(dispatch).not.toHaveBeenCalled();
  act(() => {
    alert.mock.calls
      .at(-1)?.[2]
      ?.find((button) => button.style === 'destructive')
      ?.onPress?.();
  });
  expect(dispatch).toHaveBeenCalledWith({ type: 'GO_BACK' });
  alert.mockRestore();
});
test('a missing default target is explicit and never silently replaced', async () => {
  jest.mocked(listKnowledgeBases).mockResolvedValue({ items: [other] });
  const screen = await openNew();
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(screen.getByRole('button', { name: '保存规则' })).toBeDisabled();
  fireEvent.press(screen.getByRole('button', { name: '目标知识库' }));
  fireEvent.press(screen.getByRole('radio', { name: other.name }));
  expect(screen.getByRole('button', { name: '保存规则' })).not.toBeDisabled();
});

test('home shows server group and operation cards before existing rules', async () => {
  jest.mocked(listCollectionRules).mockResolvedValue({ items: [rule] });
  const operation = jest.fn();
  const switchGroup = jest.fn();
  const screen = render(
    <CollectionRulesScreen
      groupId={groupId}
      onBack={jest.fn()}
      onOperation={operation}
      onSwitchGroup={switchGroup}
    />,
  );
  await screen.findByText('服务器当前分组');
  const cards = ['切换分组', '新增收集规则', '历史补收'].map((name) =>
    screen.getByRole('button', { name }),
  );
  expect(cards.map((card) => StyleSheet.flatten(card.props.style).height)).toEqual([88, 88, 88]);
  let iconContainer = screen.getByTestId('icon-swap-horizontal-outline').parent;
  while (iconContainer && !StyleSheet.flatten(iconContainer.props.style)?.backgroundColor) {
    iconContainer = iconContainer.parent;
  }
  expect(StyleSheet.flatten(iconContainer?.props.style).backgroundColor).toBe('transparent');
  expect(screen.queryByLabelText('规则名称')).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: '新增收集规则' }));
  expect(operation).toHaveBeenLastCalledWith('rule');
  fireEvent.press(screen.getByRole('button', { name: '历史补收' }));
  expect(operation).toHaveBeenLastCalledWith('history');
  fireEvent.press(screen.getByRole('button', { name: rule.name }));
  expect(operation).toHaveBeenLastCalledWith('rule', rule.id);
  fireEvent.press(screen.getByRole('button', { name: '切换分组' }));
  expect(switchGroup).toHaveBeenCalledTimes(1);
});

test('independent rule editor back uses navigation confirmation only once', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const dispatch = jest.fn();
  const onBack = jest.fn(() => {
    const guard = jest.mocked(usePreventRemove).mock.calls.at(-1)!;
    if (guard[0]) guard[1]({ data: { action: { type: 'GO_BACK' } } });
  });
  try {
    const screen = render(
      <CollectionRulesScreen
        groupId={groupId}
        view="rule"
        onOperation={jest.fn()}
        onBack={onBack}
        navigation={{ dispatch }}
      />,
    );
    await screen.findByLabelText('规则名称');
    await waitFor(() => expect(screen.queryByLabelText('正在加载收集与案例…')).toBeNull());
    await act(async () => {});
    fireEvent.changeText(screen.getByLabelText('规则名称'), '未保存的规则');
    fireEvent.press(screen.getByRole('button', { name: '返回' }));
    expect(alert).toHaveBeenCalledTimes(1);
    act(() => {
      alert.mock.calls
        .at(-1)![2]!
        .find((button) => button.style === 'destructive')!
        .onPress?.();
    });
    expect(alert).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: 'GO_BACK' });
  } finally {
    alert.mockRestore();
  }
});

test('guide demo editor accepts a missing server rule without a discard dialog', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const onBack = jest.fn();
  try {
    const screen = render(
      <CollectionRulesScreen
        groupId={groupId}
        guideDemo
        navigation={{ dispatch: jest.fn() }}
        onBack={onBack}
        onOperation={jest.fn()}
        view="rule"
      />,
    );
    await screen.findByLabelText('规则名称');
    await waitFor(() => expect(screen.getByRole('button', { name: '保存规则' })).toBeDisabled());
    expect(jest.mocked(usePreventRemove).mock.calls.at(-1)?.[0]).toBe(false);
    fireEvent.press(screen.getByRole('button', { name: '返回' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(alert).not.toHaveBeenCalled();
  } finally {
    alert.mockRestore();
  }
});
