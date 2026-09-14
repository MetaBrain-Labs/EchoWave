/**
 * 案例列表分页与批量审核交互测试。
 *
 * Responsibilities:
 * - 验证共享分页保留列表筛选、批量版本和部分失败反馈。
 *
 * Notes:
 * - 不生成媒体或检索文档。
 */
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { KnowledgeCase } from '@echowave/contracts';
import { KnowledgeCasesScreen } from '../KnowledgeCasesScreen';
import { batchCaseActions, listKnowledgeCases } from '@/shared/api/collectionApi';
jest.mock('@/shared/api/collectionApi');
jest.mock('@/shared/hooks/useScreenRefresh', () => ({
  useScreenRefresh: (refresh: () => Promise<void>) => ({
    refreshing: false,
    onRefresh: () => void refresh(),
  }),
}));
const id = '11111111-1111-4111-8111-111111111111';
const item: KnowledgeCase = {
  id,
  groupId: id,
  knowledgeBaseId: id,
  version: 3,
  status: 'candidate',
  origin: 'automatic',
  source: {
    audioFileId: id,
    jobId: id,
    tagId: id,
    correctionId: null,
    analysisRevisionId: id,
    confirmationVersion: 1,
    collectionMode: 'review',
  },
  sourceUpdated: false,
  content: {
    title: '价格回应',
    reason: '说明总成本',
    category: { id: 'strength', name: '优点' },
    supplement: '',
    suggestedReply: '',
    turns: [
      { segmentId: id, speakerLabel: '销售', role: 'sales', text: '原声', startMs: 0, endMs: 1000 },
    ],
  },
  availableTurns: [],
  media: [],
  documentId: null,
  publication: 'not_requested',
  publicationMessage: null,
  createdAt: '2026-09-14T00:00:00Z',
  updatedAt: '2026-09-14T00:00:00Z',
};
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(listKnowledgeCases).mockResolvedValue({ items: [item] });
});
test('candidate tab uses shared semantics and keeps versioned batch failures selected', async () => {
  jest
    .mocked(batchCaseActions)
    .mockResolvedValue({ items: [{ id, success: false, message: '冲突' }] });
  const onOpen = jest.fn();
  const screen = render(
    <KnowledgeCasesScreen knowledgeId={id} onBack={jest.fn()} onOpen={onOpen} />,
  );
  const candidate = await screen.findByRole('tab', { name: /待审核.*1/ });
  fireEvent.press(candidate);
  expect(candidate).toHaveProp('accessibilityState', { selected: true });
  fireEvent.press(screen.getByRole('checkbox', { name: `选择案例：${item.content.title}` }));
  fireEvent.press(screen.getByRole('button', { name: '批量精选入库' }));
  await waitFor(() =>
    expect(batchCaseActions).toHaveBeenCalledWith([{ id, expectedVersion: 3, action: 'publish' }]),
  );
  expect(screen.getByRole('checkbox', { name: `选择案例：${item.content.title}` })).toHaveProp(
    'accessibilityState',
    {
      checked: true,
    },
  );
  fireEvent.press(screen.getAllByRole('button', { name: '查看案例与回听' })[0]);
  expect(onOpen).toHaveBeenCalledWith(id);
  fireEvent.press(screen.getByRole('tab', { name: /历史/ }));
  expect(screen.queryByRole('checkbox')).toBeNull();
});
