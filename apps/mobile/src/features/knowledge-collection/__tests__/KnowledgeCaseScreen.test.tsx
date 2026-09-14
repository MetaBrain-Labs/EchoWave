/**
 * 案例审核与回听交互回归。
 *
 * 通过共享真实播放控制器验证轮次顺序、缺失音频、审核失败和编辑保留。
 *
 * Responsibilities:
 * - 覆盖候选入库、正式案例原声和失败重试。
 *
 * Notes:
 * - 网络由替身控制，不进行设备录音。
 */
import { RefreshControl } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { KnowledgeCase } from '@echowave/contracts';
import { KnowledgeCaseScreen } from '../KnowledgeCaseScreen';
import {
  actOnKnowledgeCase,
  getKnowledgeCase,
  updateKnowledgeCase,
} from '@/shared/api/collectionApi';
import { mockAudioPlayers, resetExpoAudioMock } from '@/test/ExpoAudioMock';
jest.mock('@/shared/api/collectionApi');
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }));
jest.mock('@/shared/hooks/useScreenRefresh', () => ({
  useScreenRefresh: (refresh: () => Promise<void>) => ({
    refreshing: false,
    onRefresh: () => void refresh(),
  }),
}));
const id = '11111111-1111-4111-8111-111111111111';
const turns: KnowledgeCase['content']['turns'] = [
  {
    segmentId: '22222222-2222-4222-8222-222222222222',
    speakerLabel: 'A',
    role: 'customer',
    text: '价格有点高',
    startMs: 1000,
    endMs: 2000,
  },
  {
    segmentId: '33333333-3333-4333-8333-333333333333',
    speakerLabel: 'B',
    role: 'sales',
    text: '可以先比较总成本',
    startMs: 2000,
    endMs: 3000,
  },
];
const fixture: KnowledgeCase = {
  id,
  groupId: id,
  knowledgeBaseId: id,
  version: 1,
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
    category: { id: 'strength', name: '优点' },
    title: '价格异议',
    reason: '解释选择依据',
    supplement: '',
    suggestedReply: '建议先询问预算',
    turns,
  },
  availableTurns: turns,
  documentId: null,
  publication: 'not_requested',
  publicationMessage: null,
  media: turns.map((t) => ({
    segmentId: t.segmentId,
    status: 'pending',
    message: null,
    url: null,
  })),
  createdAt: '2026-09-14T00:00:00Z',
  updatedAt: '2026-09-14T00:00:00Z',
};
beforeEach(() => {
  jest.clearAllMocks();
  resetExpoAudioMock();
  jest.mocked(getKnowledgeCase).mockResolvedValue(fixture);
});
test('candidate review sends its version and exposes a retryable failure', async () => {
  jest
    .mocked(actOnKnowledgeCase)
    .mockRejectedValueOnce(new Error('conflict'))
    .mockResolvedValueOnce({ ...fixture, status: 'published', version: 2, publication: 'failed' });
  const screen = render(<KnowledgeCaseScreen caseId={id} onBack={jest.fn()} />);
  await screen.findByText('价格异议');
  fireEvent.press(screen.getByRole('button', { name: '精选入库' }));
  await screen.findByText(/保存未完成/);
  fireEvent.press(screen.getByRole('button', { name: '精选入库' }));
  await waitFor(() => expect(actOnKnowledgeCase).toHaveBeenLastCalledWith(id, 1, 'publish'));
  await screen.findByText('正式案例', { exact: false });
});
test('version conflict preserves edited content through refresh', async () => {
  jest.mocked(updateKnowledgeCase).mockRejectedValue(new Error('conflict'));
  const screen = render(<KnowledgeCaseScreen caseId={id} onBack={jest.fn()} />);
  await screen.findByText('价格异议');
  fireEvent.press(screen.getByRole('button', { name: '更多操作' }));
  fireEvent.press(screen.getByRole('button', { name: '编辑案例' }));
  fireEvent.changeText(screen.getByLabelText('评价与理由'), '人工补充理由');
  fireEvent.press(screen.getByRole('button', { name: '保存案例新版本' }));
  await screen.findByText(/保存未完成/);
  fireEvent(screen.UNSAFE_getByType(RefreshControl), 'refresh');
  await waitFor(() => expect(getKnowledgeCase).toHaveBeenCalledTimes(2));
  expect(screen.getByLabelText('评价与理由').props.value).toBe('人工补充理由');
});
test('formal dialogue plays independent customer then sales audio in order, and retries playback errors', async () => {
  const media = turns.map((t) => ({
    segmentId: t.segmentId,
    status: 'ready' as const,
    message: null,
    url: `/api/knowledge-cases/${id}/media/${t.segmentId}?version=1`,
  }));
  jest
    .mocked(getKnowledgeCase)
    .mockResolvedValue({ ...fixture, status: 'published', publication: 'ready', media });
  const screen = render(<KnowledgeCaseScreen caseId={id} onBack={jest.fn()} />);
  await screen.findByText('价格异议');
  fireEvent.press(screen.getByRole('button', { name: '连续回听对话' }));
  const player = mockAudioPlayers[0];
  await waitFor(() =>
    expect(player.source).toEqual({ uri: expect.stringContaining(turns[0].segmentId) }),
  );
  await act(async () => player.update({ didJustFinish: true, playing: false }));
  await waitFor(() =>
    expect(player.source).toEqual({ uri: expect.stringContaining(turns[1].segmentId) }),
  );
  await act(async () => player.update({ error: 'playback failed', playing: false }));
  await screen.findByText('音频播放失败，请重试。');
  fireEvent.press(screen.getByRole('button', { name: '重试播放' }));
  await waitFor(() => expect(player.replace).toHaveBeenCalledTimes(3));
});
test('missing source keeps the text case and disables all unavailable formal playback', async () => {
  jest.mocked(getKnowledgeCase).mockResolvedValue({
    ...fixture,
    status: 'published',
    publication: 'ready',
    media: fixture.media.map((m) => ({ ...m, status: 'missing', message: '请恢复源音频' })),
  });
  const screen = render(<KnowledgeCaseScreen caseId={id} onBack={jest.fn()} />);
  await screen.findByText('价格异议');
  expect(screen.getByRole('button', { name: '回听顾客' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '连续回听对话' })).toBeDisabled();
  expect(screen.getByText('价格有点高')).toBeTruthy();
});

test('candidate turn control shows source range and toggles its own pause', async () => {
  const screen = render(<KnowledgeCaseScreen caseId={id} onBack={jest.fn()} />);
  await screen.findByText('00:01–00:02');
  const control = screen.getAllByRole('button', { name: '回听原音频片段' })[0];
  fireEvent.press(control);
  const player = mockAudioPlayers[0];
  await waitFor(() => expect(player.seekTo).toHaveBeenCalledWith(1));
  await act(async () => player.update({ playing: true, currentTime: 1.5 }));
  fireEvent.press(screen.getAllByRole('button', { name: '回听原音频片段' })[0]);
  await waitFor(() => expect(player.pause).toHaveBeenCalled());
  expect(screen.queryByRole('button', { name: '暂停播放' })).toBeNull();
});

test('candidate playback retry seeks back to its evidence rather than playing the whole source', async () => {
  const screen = render(<KnowledgeCaseScreen caseId={id} onBack={jest.fn()} />);
  await screen.findByText('00:01–00:02');
  fireEvent.press(screen.getAllByRole('button', {name:'回听原音频片段'})[0]);
  const player = mockAudioPlayers[0];
  await waitFor(() => expect(player.seekTo).toHaveBeenCalledWith(1));
  await act(async () => player.update({error:'failed',playing:false,currentTime:1.5}));
  fireEvent.press(screen.getByRole('button', {name:'重试播放'}));
  await waitFor(() => expect(player.seekTo).toHaveBeenCalledTimes(2));
  expect(player.seekTo).toHaveBeenLastCalledWith(1);
});
