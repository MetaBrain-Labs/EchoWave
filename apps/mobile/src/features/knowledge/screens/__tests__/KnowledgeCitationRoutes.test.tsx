/**
 * 知识问答引用路由测试。
 *
 * 验证聊天来源标记会贯穿引用块、相邻块和原文详情，并使用导航栈返回原聊天。
 *
 * Responsibilities:
 * - 锁定问答引用的返回语义。
 * - 保持普通文档导航不受聊天来源逻辑影响。
 */
import { fireEvent, render } from '@testing-library/react-native';
import {
  Pressable as MockPressable,
  Text as MockText,
  View as MockView,
} from 'react-native';

import KnowledgeQueryRoute from '../../../../app/knowledge/[knowledgeId]/ask';
import DocumentDetailRoute from '../../../../app/knowledge/[knowledgeId]/files/[fileId]';
import BlockDetailRoute from '../../../../app/knowledge/[knowledgeId]/files/[fileId]/blocks/[blockId]';

const mockRouter = {
  back: jest.fn(),
  canGoBack: jest.fn(() => true),
  push: jest.fn(),
  replace: jest.fn(),
};
let mockRouteParams: Record<string, string> = {};

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockRouteParams,
  useRouter: () => mockRouter,
}));
jest.mock('@/shared/navigation/NavigationLoadingProvider', () => ({
  useNavigationLoading: () => ({
    runWithLoading: async (operation: () => unknown) => operation(),
  }),
}));
jest.mock('@/features/knowledge/screens/KnowledgeQueryScreen', () => {
  return {
    KnowledgeQueryScreen: ({ onOpenCitation }: { onOpenCitation: (documentId: string, chunkId: string) => void }) => (
      <MockPressable onPress={() => onOpenCitation('document-id', 'chunk-id')}><MockText>打开引用</MockText></MockPressable>
    ),
  };
});
jest.mock('@/features/knowledge/screens/BlockDetailScreen', () => {
  return {
    BlockDetailScreen: ({ onBack, onLocateOriginal, onNavigateBlock }: {
      onBack: () => void;
      onLocateOriginal: (id: string) => void;
      onNavigateBlock: (id: string) => void;
    }) => (
      <MockView>
        <MockPressable onPress={onBack}><MockText>引用返回</MockText></MockPressable>
        <MockPressable onPress={() => onNavigateBlock('next-chunk')}><MockText>相邻块</MockText></MockPressable>
        <MockPressable onPress={() => onLocateOriginal('chunk-id')}><MockText>定位原文</MockText></MockPressable>
      </MockView>
    ),
  };
});
jest.mock('@/features/knowledge/screens/DocumentDetailScreen', () => {
  return {
    DocumentDetailScreen: ({ onBack, onOpenBlock }: { onBack: () => void; onOpenBlock: (id: string) => void }) => (
      <MockView>
        <MockPressable onPress={onBack}><MockText>原文返回</MockText></MockPressable>
        <MockPressable onPress={() => onOpenBlock('another-chunk')}><MockText>原文打开块</MockText></MockPressable>
      </MockView>
    ),
  };
});

describe('knowledge citation routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouter.canGoBack.mockReturnValue(true);
  });

  it('marks citations opened from the query route', () => {
    mockRouteParams = { knowledgeId: 'knowledge-id' };
    const screen = render(<KnowledgeQueryRoute />);

    fireEvent.press(screen.getByText('打开引用'));

    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/knowledge/[knowledgeId]/files/[fileId]/blocks/[blockId]',
      params: {
        knowledgeId: 'knowledge-id',
        fileId: 'document-id',
        blockId: 'chunk-id',
        returnTo: 'knowledge-query',
      },
    });
  });

  it('returns to chat and propagates its marker across block navigation', () => {
    mockRouteParams = {
      knowledgeId: 'knowledge-id',
      fileId: 'document-id',
      blockId: 'chunk-id',
      returnTo: 'knowledge-query',
    };
    const screen = render(<BlockDetailRoute />);

    fireEvent.press(screen.getByText('引用返回'));
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
    expect(mockRouter.replace).not.toHaveBeenCalled();

    fireEvent.press(screen.getByText('相邻块'));
    expect(mockRouter.replace).toHaveBeenCalledWith(expect.objectContaining({
      params: expect.objectContaining({ returnTo: 'knowledge-query', blockId: 'next-chunk' }),
    }));

    fireEvent.press(screen.getByText('定位原文'));
    expect(mockRouter.replace).toHaveBeenCalledWith(expect.objectContaining({
      params: expect.objectContaining({ returnTo: 'knowledge-query', tab: 'original' }),
    }));
  });

  it('returns from original content to chat and keeps the marker when opening another block', () => {
    mockRouteParams = {
      knowledgeId: 'knowledge-id',
      fileId: 'document-id',
      block: 'chunk-id',
      tab: 'original',
      returnTo: 'knowledge-query',
    };
    const screen = render(<DocumentDetailRoute />);

    fireEvent.press(screen.getByText('原文返回'));
    expect(mockRouter.back).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByText('原文打开块'));
    expect(mockRouter.push).toHaveBeenCalledWith(expect.objectContaining({
      params: expect.objectContaining({ returnTo: 'knowledge-query', blockId: 'another-chunk' }),
    }));
  });
});
