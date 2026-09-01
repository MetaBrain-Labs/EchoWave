/**
 * 资源来源导航测试。
 *
 * 验证分组与独立列表入口会携带来源，并让数据源、分析和知识库层级返回真实父页面。
 *
 * Responsibilities:
 * - 锁定来源参数的创建、透传与安全回退。
 * - 防止详情页再次依赖不稳定的历史栈返回。
 *
 * Notes:
 * - 页面内容使用最小交互替身，仅测试 Expo Router 协调行为。
 */
import { fireEvent, render } from '@testing-library/react-native';
import { Pressable as MockPressable, Text as MockText, View as MockView } from 'react-native';

import GroupRoute from '../../../app/(tabs)/index';
import KnowledgeListRoute from '../../../app/(tabs)/knowledge';
import SourceListRoute from '../../../app/(tabs)/sources';
import AnalysisDetailRoute from '../../../app/analysis/[id]';
import KnowledgeDetailRoute from '../../../app/knowledge/[knowledgeId]';
import DocumentDetailRoute from '../../../app/knowledge/[knowledgeId]/files/[fileId]';
import SourceDetailRoute from '../../../app/sources/[sourceId]';

const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  setParams: jest.fn(),
};
let mockRouteParams: Record<string, string> = {};

jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
  useLocalSearchParams: () => mockRouteParams,
  useRouter: () => mockRouter,
}));

jest.mock('@/features/group/GroupScreen', () => ({
  GroupScreen: ({
    onGroupChange,
    onOpenKnowledge,
    onOpenSource,
    onTabChange,
  }: {
    onGroupChange: (id: string) => void;
    onOpenKnowledge: (id: string, groupId: string) => void;
    onOpenSource: (id: string, groupId: string) => void;
    onTabChange: (tab: 'sources') => void;
  }) => (
    <MockView>
      <MockPressable onPress={() => onGroupChange('group-id')}>
        <MockText>同步分组</MockText>
      </MockPressable>
      <MockPressable onPress={() => onTabChange('sources')}>
        <MockText>同步标签</MockText>
      </MockPressable>
      <MockPressable onPress={() => onOpenSource('source-id', 'group-id')}>
        <MockText>打开分组数据源</MockText>
      </MockPressable>
      <MockPressable onPress={() => onOpenKnowledge('knowledge-id', 'group-id')}>
        <MockText>打开分组知识库</MockText>
      </MockPressable>
    </MockView>
  ),
}));

jest.mock('@/features/data-sources/screens/DataSourceListScreen', () => ({
  DataSourceListScreen: ({ onOpenSource }: { onOpenSource: (id: string) => void }) => (
    <MockPressable onPress={() => onOpenSource('source-id')}>
      <MockText>打开总数据源</MockText>
    </MockPressable>
  ),
}));

jest.mock('@/features/data-sources/screens/DataSourceDetailScreen', () => ({
  DataSourceDetailScreen: ({
    onBack,
    onOpenAudio,
  }: {
    onBack: () => void;
    onOpenAudio: (id: string, groupId: string) => void;
  }) => (
    <MockView>
      <MockPressable onPress={onBack}>
        <MockText>数据源返回</MockText>
      </MockPressable>
      <MockPressable onPress={() => onOpenAudio('audio-id', 'analysis-group-id')}>
        <MockText>打开数据源分析</MockText>
      </MockPressable>
    </MockView>
  ),
}));

jest.mock('@/features/analysis-detail/AnalysisDetailScreen', () => ({
  AnalysisDetailScreen: ({ onBack }: { onBack: () => void }) => (
    <MockPressable onPress={onBack}>
      <MockText>分析返回</MockText>
    </MockPressable>
  ),
}));

jest.mock('@/features/knowledge/screens/KnowledgeListScreen', () => ({
  KnowledgeListScreen: ({ onOpenKnowledge }: { onOpenKnowledge: (id: string) => void }) => (
    <MockPressable onPress={() => onOpenKnowledge('knowledge-id')}>
      <MockText>打开总知识库</MockText>
    </MockPressable>
  ),
}));

jest.mock('@/features/knowledge/screens/KnowledgeDetailScreen', () => ({
  KnowledgeDetailScreen: ({
    onBack,
    onOpenDocument,
  }: {
    onBack: () => void;
    onOpenDocument: (id: string) => void;
  }) => (
    <MockView>
      <MockPressable onPress={onBack}>
        <MockText>知识库返回</MockText>
      </MockPressable>
      <MockPressable onPress={() => onOpenDocument('document-id')}>
        <MockText>打开知识文档</MockText>
      </MockPressable>
    </MockView>
  ),
}));

jest.mock('@/features/knowledge/screens/DocumentDetailScreen', () => ({
  DocumentDetailScreen: ({ onBack }: { onBack: () => void }) => (
    <MockPressable onPress={onBack}>
      <MockText>知识文档返回</MockText>
    </MockPressable>
  ),
}));

describe('resource origin navigation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteParams = {};
  });

  it('writes group context and marks resources opened from the group page', () => {
    const screen = render(<GroupRoute />);

    fireEvent.press(screen.getByText('同步分组'));
    expect(mockRouter.setParams).toHaveBeenCalledWith({ groupId: 'group-id' });
    fireEvent.press(screen.getByText('同步标签'));
    expect(mockRouter.setParams).toHaveBeenCalledWith({ tab: 'sources' });

    fireEvent.press(screen.getByText('打开分组数据源'));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/sources/[sourceId]',
      params: { sourceId: 'source-id', groupId: 'group-id', origin: 'group' },
    });
    fireEvent.press(screen.getByText('打开分组知识库'));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/knowledge/[knowledgeId]',
      params: { knowledgeId: 'knowledge-id', groupId: 'group-id', origin: 'group' },
    });
  });

  it('marks resources opened from independent lists', () => {
    const sourceScreen = render(<SourceListRoute />);
    fireEvent.press(sourceScreen.getByText('打开总数据源'));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/sources/[sourceId]',
      params: { sourceId: 'source-id', origin: 'source-list' },
    });
    sourceScreen.unmount();

    const knowledgeScreen = render(<KnowledgeListRoute />);
    fireEvent.press(knowledgeScreen.getByText('打开总知识库'));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/knowledge/[knowledgeId]',
      params: { knowledgeId: 'knowledge-id', origin: 'knowledge-list' },
    });
  });

  it('returns a grouped source through analysis to its original group tab', () => {
    mockRouteParams = { sourceId: 'source-id', groupId: 'group-id', origin: 'group' };
    const sourceScreen = render(<SourceDetailRoute />);
    fireEvent.press(sourceScreen.getByText('打开数据源分析'));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/analysis/[id]',
      params: {
        id: 'audio-id',
        groupId: 'analysis-group-id',
        origin: 'group',
        originGroupId: 'group-id',
        returnSourceId: 'source-id',
      },
    });
    sourceScreen.unmount();

    mockRouteParams = {
      id: 'audio-id',
      groupId: 'analysis-group-id',
      origin: 'group',
      originGroupId: 'group-id',
      returnSourceId: 'source-id',
    };
    const analysisScreen = render(<AnalysisDetailRoute />);
    fireEvent.press(analysisScreen.getByText('分析返回'));
    expect(mockRouter.replace).toHaveBeenCalledWith({
      pathname: '/sources/[sourceId]',
      params: { sourceId: 'source-id', origin: 'group', groupId: 'group-id' },
    });
    analysisScreen.unmount();

    mockRouteParams = { sourceId: 'source-id', groupId: 'group-id', origin: 'group' };
    const restoredSourceScreen = render(<SourceDetailRoute />);
    fireEvent.press(restoredSourceScreen.getByText('数据源返回'));
    expect(mockRouter.replace).toHaveBeenCalledWith({
      pathname: '/',
      params: { groupId: 'group-id', tab: 'sources' },
    });
  });

  it('propagates grouped knowledge context to documents and falls back safely', () => {
    mockRouteParams = { knowledgeId: 'knowledge-id', groupId: 'group-id', origin: 'group' };
    const detailScreen = render(<KnowledgeDetailRoute />);
    fireEvent.press(detailScreen.getByText('打开知识文档'));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/knowledge/[knowledgeId]/files/[fileId]',
      params: {
        fileId: 'document-id',
        knowledgeId: 'knowledge-id',
        origin: 'group',
        groupId: 'group-id',
      },
    });
    detailScreen.unmount();

    mockRouteParams = {
      knowledgeId: 'knowledge-id',
      fileId: 'document-id',
      origin: 'group',
      groupId: 'group-id',
    };
    const documentScreen = render(<DocumentDetailRoute />);
    fireEvent.press(documentScreen.getByText('知识文档返回'));
    expect(mockRouter.replace).toHaveBeenCalledWith({
      pathname: '/knowledge/[knowledgeId]',
      params: { knowledgeId: 'knowledge-id', origin: 'group', groupId: 'group-id' },
    });
    documentScreen.unmount();

    mockRouteParams = { knowledgeId: 'knowledge-id', origin: 'invalid' };
    const fallbackScreen = render(<KnowledgeDetailRoute />);
    fireEvent.press(fallbackScreen.getByText('知识库返回'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/(tabs)/knowledge');
  });
});
