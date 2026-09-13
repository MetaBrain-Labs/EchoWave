/**
 * 历史引用快照交互回归。
 *
 * 验证删除、更新和网络失败时仍可阅读快照，且只有校验后的 active 来源允许跳转。
 *
 * Responsibilities:
 * - 验证知识生命周期的用户交互与失败恢复。
 *
 * Notes:
 * - 仅使用固定固件和模拟 API，不连接真实服务。
 */
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { getKnowledgeCitationSource } from '@/shared/api/knowledgeBasesApi';
import { CitationSnapshotModal, type CitationSnapshot } from '../CitationSnapshotModal';

jest.mock('@/shared/api/knowledgeBasesApi');

const citation: CitationSnapshot = {
  knowledgeBaseId: '11111111-1111-4111-8111-111111111111',
  documentId: '22222222-2222-4222-8222-222222222222',
  revisionId: '33333333-3333-4333-8333-333333333333',
  chunkId: '44444444-4444-4444-8444-444444444444',
  documentTitle: '历史销售规范.md',
  quoteSnapshot: '历史原文：只能使用可核实的销售案例。',
  excerpt: '只能使用可核实的销售案例。',
  locator: { kind: 'markdown', headingPath: [], lineStart: 3, lineEnd: 4 },
};

describe('CitationSnapshotModal', () => {
  beforeEach(() => jest.resetAllMocks());
  it.each([
    ['deleted', '源知识已删除，以下为当时引用快照。'],
    ['superseded', '源知识已更新，以下为当时引用快照。'],
  ] as const)('preserves a %s snapshot without a current-source link', async (status, label) => {
    jest.mocked(getKnowledgeCitationSource).mockResolvedValue({ status });
    const onOpenCurrent = jest.fn();
    const screen = render(
      <CitationSnapshotModal
        citation={citation}
        onClose={jest.fn()}
        onOpenCurrent={onOpenCurrent}
      />,
    );
    await waitFor(() => expect(screen.getByText(label)).toBeTruthy());
    expect(screen.getByText(citation.quoteSnapshot!)).toBeTruthy();
    expect(screen.queryByText('查看当前原文')).toBeNull();
    expect(onOpenCurrent).not.toHaveBeenCalled();
  });
  it('retries failed source verification before enabling navigation', async () => {
    jest
      .mocked(getKnowledgeCitationSource)
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ status: 'active' });
    const onOpenCurrent = jest.fn();
    const screen = render(
      <CitationSnapshotModal
        citation={citation}
        onClose={jest.fn()}
        onOpenCurrent={onOpenCurrent}
      />,
    );
    await waitFor(() => expect(screen.getByText('无法确认来源状态，请重试。')).toBeTruthy());
    expect(screen.queryByText('查看当前原文')).toBeNull();
    fireEvent.press(screen.getByText('重试'));
    await waitFor(() => expect(screen.getByText('查看当前原文')).toBeTruthy());
    fireEvent.press(screen.getByText('查看当前原文'));
    expect(onOpenCurrent).toHaveBeenCalledTimes(1);
  });
});
