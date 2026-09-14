/**
 * 人工纠正与手动收集交互回归。
 *
 * Responsibilities:
 * - 验证固定证据上下文、目标库和纠正失败后的输入保留。
 *
 * Notes:
 * - 不调用模型或真实 API。
 */
import { RefreshControl } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { CollectionCapture, KnowledgeBaseSummary } from '@echowave/contracts';
import { CollectionCaptureScreen } from '../CollectionCaptureScreen';
import {
  collectKnowledgeCase,
  getCollectionCapture,
  listAnalysisCorrections,
  listCollectionRules,
  saveAnalysisCorrection,
} from '@/shared/api/collectionApi';
import { listKnowledgeBases } from '@/shared/api/knowledgeBasesApi';
jest.mock('@/shared/api/collectionApi');
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }));
jest.mock('@/shared/hooks/useScreenRefresh', () => ({
  useScreenRefresh: (refresh: () => Promise<void>) => ({
    refreshing: false,
    onRefresh: () => void refresh(),
  }),
}));
jest.mock('@/shared/api/knowledgeBasesApi');
const id = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';
const capture: CollectionCapture = {
  jobId: id,
  groupId: id,
  availableTurns: [
    { segmentId: id, speakerLabel: 'A', role: 'customer', text: '价格高', startMs: 0, endMs: 1000 },
    {
      segmentId: second,
      speakerLabel: 'B',
      role: 'sales',
      text: '我们比较总成本',
      startMs: 1000,
      endMs: 2000,
    },
  ],
  tags: [
    {
      id,
      category: 'strength',
      customLabel: null,
      title: '回应价格异议',
      reason: '原始 AI 理由',
      segmentIds: [second],
    },
  ],
};
const base: KnowledgeBaseSummary = {
  id,
  name: '优秀话术知识库',
  description: '',
  documentCount: 0,
  linkedGroupCount: 0,
  updatedAt: '2026-09-14T00:00:00Z',
};
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getCollectionCapture).mockResolvedValue(capture);
  jest.mocked(listKnowledgeBases).mockResolvedValue({ items: [base] });
  jest.mocked(listCollectionRules).mockResolvedValue({ items: [] });
  jest.mocked(listAnalysisCorrections).mockResolvedValue({ items: [] });
});
test('manual collection requires a target and includes the preceding customer turn', async () => {
  jest.mocked(collectKnowledgeCase).mockRejectedValue(new Error('network'));
  const screen = render(
    <CollectionCaptureScreen jobId={id} tagId={id} onBack={jest.fn()} onSaved={jest.fn()} />,
  );
  await screen.findByText('我们比较总成本');
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '保存为待审核案例' })).not.toBeDisabled(),
  );
  fireEvent.press(screen.getByRole('button', { name: '保存为待审核案例' }));
  await screen.findByText(/请填写名称/);
  expect(collectKnowledgeCase).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: '目标知识库' }));
  fireEvent.press(screen.getByRole('radio', { name: '优秀话术知识库' }));
  fireEvent.press(screen.getByRole('button', { name: '保存为待审核案例' }));
  await waitFor(() =>
    expect(collectKnowledgeCase).toHaveBeenCalledWith(
      expect.objectContaining({
        tagId: id,
        knowledgeBaseId: id,
        content: expect.objectContaining({ turns: capture.availableTurns }),
      }),
    ),
  );
});
test('failed human correction preserves inputs and original AI judgment on refresh', async () => {
  jest.mocked(saveAnalysisCorrection).mockRejectedValue(new Error('version conflict'));
  const screen = render(
    <CollectionCaptureScreen
      jobId={id}
      tagId={id}
      correct
      onBack={jest.fn()}
      onSaved={jest.fn()}
    />,
  );
  await screen.findByText('原始 AI 理由');
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '保存人工纠正' })).not.toBeDisabled(),
  );
  fireEvent.changeText(screen.getByLabelText('评价与理由'), '人工解释');
  fireEvent.press(screen.getByRole('button', { name: '待改进' }));
  fireEvent.press(screen.getByRole('button', { name: '保存人工纠正' }));
  await screen.findByText(/保存未完成/);
  fireEvent(screen.UNSAFE_getByType(RefreshControl), 'refresh');
  await waitFor(() => expect(getCollectionCapture).toHaveBeenCalledTimes(2));
  expect(screen.getByLabelText('评价与理由').props.value).toBe('人工解释');
  expect(screen.getByText('原始 AI 理由')).toBeTruthy();
  expect(saveAnalysisCorrection).toHaveBeenCalledWith(
    id,
    id,
    expect.objectContaining({
      expectedVersion: 0,
      category: 'improvement',
      reason: '人工解释',
    }),
  );
});
