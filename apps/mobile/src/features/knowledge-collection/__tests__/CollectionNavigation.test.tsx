/**
 * 知识收集路由上下文测试。
 *
 * Responsibilities:
 * - 验证来源分组、关联分组和默认知识库的独立传递。
 * - 保持旧案例链接的优先级。
 *
 * Notes:
 * - 页面用交互替身隔离路由协调。
 */
import { fireEvent, render } from '@testing-library/react-native';
import { Pressable as MockPressable, Text as MockText, View as MockView } from 'react-native';
import CollectionRoute from '@/app/collection';
import KnowledgeRoute from '@/app/knowledge/[knowledgeId]';
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
let mockParams: Record<string, string> = {};
let mockAssociations: string[] = [];
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useNavigation: () => ({}),
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/features/knowledge/screens/KnowledgeDetailScreen', () => ({
  KnowledgeDetailScreen: ({ onOpenCollection }: { onOpenCollection: (ids: string[]) => void }) => (
    <MockPressable onPress={() => onOpenCollection(mockAssociations)}>
      <MockText>收集设置</MockText>
    </MockPressable>
  ),
}));
jest.mock('../CollectionGroupsScreen', () => ({
  CollectionGroupsScreen: ({
    defaultKnowledgeId,
    onSelect,
  }: {
    defaultKnowledgeId?: string;
    onSelect: (id: string) => void;
  }) => (
    <MockPressable onPress={() => onSelect('chosen')}>
      <MockText>选择分组 {defaultKnowledgeId}</MockText>
    </MockPressable>
  ),
}));
jest.mock('../CollectionRulesScreen', () => ({
  CollectionRulesScreen: ({
    groupId,
    defaultKnowledgeId,
    onSwitchGroup,
  }: {
    groupId: string;
    defaultKnowledgeId?: string;
    onSwitchGroup: () => void;
  }) => (
    <MockView>
      <MockText>
        规则 {groupId} {defaultKnowledgeId}
      </MockText>
      <MockPressable onPress={onSwitchGroup}>
        <MockText>切组</MockText>
      </MockPressable>
    </MockView>
  ),
}));
jest.mock('../KnowledgeCasesScreen', () => ({
  KnowledgeCasesScreen: () => <MockText>案例列表</MockText>,
}));
jest.mock('../KnowledgeCaseScreen', () => ({
  KnowledgeCaseScreen: () => <MockText>案例详情</MockText>,
}));
jest.mock('../CollectionCaptureScreen', () => ({
  CollectionCaptureScreen: () => <MockText>手动收集</MockText>,
}));
beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockAssociations = [];
});
test.each([
  ['origin', ['linked'], 'origin'],
  ['', ['linked'], 'linked'],
  ['', ['one', 'two'], undefined],
  ['', [], undefined],
])(
  'knowledge entry resolves origin %s and associations %j',
  (origin, associations, expectedGroup) => {
    mockParams = { knowledgeId: 'library', groupId: origin as string };
    mockAssociations = associations as string[];
    const screen = render(<KnowledgeRoute />);
    fireEvent.press(screen.getByText('收集设置'));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/collection',
      params: {
        defaultKnowledgeId: 'library',
        ...(expectedGroup ? { groupId: expectedGroup } : {}),
      },
    });
  },
);
test('group selection and switching preserve the default library', () => {
  mockParams = { defaultKnowledgeId: 'library' };
  const screen = render(<CollectionRoute />);
  fireEvent.press(screen.getByText('选择分组 library'));
  expect(mockRouter.push).toHaveBeenLastCalledWith({
    pathname: '/collection',
    params: { groupId: 'chosen', defaultKnowledgeId: 'library' },
  });
  mockParams = { groupId: 'chosen', defaultKnowledgeId: 'library' };
  screen.rerender(<CollectionRoute />);
  fireEvent.press(screen.getByText('切组'));
  expect(mockRouter.push).toHaveBeenLastCalledWith({
    pathname: '/collection',
    params: { defaultKnowledgeId: 'library' },
  });
});
test.each([
  [{ knowledgeId: 'library' }, '案例列表'],
  [{ caseId: 'case', knowledgeId: 'library' }, '案例详情'],
  [{ jobId: 'job', groupId: 'group' }, '手动收集'],
  [{}, '选择分组 '],
])('existing collection links keep their destination', (params, expected) => {
  mockParams = params as Record<string, string>;
  const screen = render(<CollectionRoute />);
  expect(screen.getByText(expected)).toBeTruthy();
});
