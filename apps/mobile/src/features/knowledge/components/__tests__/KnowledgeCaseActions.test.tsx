/**
 * 案例文档抽屉交互回归。
 *
 * Responsibilities:
 * - 覆盖确认、网络失败保留菜单和版本冲突后显式读取。
 * Notes:
 * - 不运行入库 Worker 或触碰实际媒体。
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import type { KnowledgeCase } from '@echowave/contracts';
import { KnowledgeCaseActions } from '../KnowledgeCaseActions';
import { actOnKnowledgeCase, getKnowledgeCase } from '@/shared/api/collectionApi';
jest.mock('@/shared/api/collectionApi');
const id = '11111111-1111-4111-8111-111111111111';
const item: KnowledgeCase = {
  id,
  groupId: id,
  knowledgeBaseId: id,
  version: 3,
  status: 'published',
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
    category: { id: 'strength', name: '优点' },
    title: '价格回应',
    reason: '总成本比较',
    supplement: '',
    suggestedReply: '',
    turns: [],
  },
  availableTurns: [],
  documentId: id,
  publication: 'ready',
  publicationMessage: null,
  media: [],
  createdAt: '2026-09-14T00:00:00Z',
  updatedAt: '2026-09-14T00:00:00Z',
};
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getKnowledgeCase).mockResolvedValue(item);
});
test('withdraw requires confirmation and version conflict preserves menu until explicit read', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest
    .mocked(actOnKnowledgeCase)
    .mockRejectedValueOnce(new Error('conflict'))
    .mockResolvedValueOnce({ ...item, version: 5, status: 'withdrawn' });
  const close = jest.fn(),
    changed = jest.fn();
  const screen = render(
    <KnowledgeCaseActions caseId={id} onClose={close} onOpen={jest.fn()} onChanged={changed} />,
  );
  await screen.findByText(item.content.title);
  fireEvent.press(screen.getByRole('button', { name: '撤回案例' }));
  expect(actOnKnowledgeCase).not.toHaveBeenCalled();
  await act(async () =>
    alert.mock.calls
      .at(-1)?.[2]
      ?.find((button) => button.text === '撤回案例')
      ?.onPress?.(),
  );
  await screen.findByText(/操作未完成/);
  expect(close).not.toHaveBeenCalled();
  jest.mocked(getKnowledgeCase).mockResolvedValue({ ...item, version: 4 });
  fireEvent.press(screen.getByRole('button', { name: '读取最新状态' }));
  await waitFor(() => expect(getKnowledgeCase).toHaveBeenCalledTimes(2));
  fireEvent.press(screen.getByRole('button', { name: '撤回案例' }));
  await act(async () =>
    alert.mock.calls
      .at(-1)?.[2]
      ?.find((button) => button.text === '撤回案例')
      ?.onPress?.(),
  );
  await waitFor(() => expect(actOnKnowledgeCase).toHaveBeenLastCalledWith(id, 4, 'withdraw'));
  expect(changed).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledTimes(1);
  alert.mockRestore();
});
test('retry appears only for failed retryable stages and never offers generated document replacement', async () => {
  jest.mocked(getKnowledgeCase).mockResolvedValue({
    ...item,
    publication: 'failed',
    publicationRetryable: false,
    publicationMessage: '不可直接重试',
  });
  const screen = render(
    <KnowledgeCaseActions
      caseId={id}
      onClose={jest.fn()}
      onOpen={jest.fn()}
      onChanged={jest.fn()}
    />,
  );
  await screen.findByText('不可直接重试');
  expect(screen.queryByRole('button', { name: '重试' })).toBeNull();
  expect(screen.queryByText(/替换上传/)).toBeNull();
});
