/**
 * 知识库详情页面测试。
 *
 * 验证知识库概览、文档展示、上传与问答入口等主要行为。
 *
 * Responsibilities:
 * - 覆盖知识库详情的加载和导航交互。
 *
 * Notes:
 * - 服务端请求由 feature 级 mock 控制。
 */
import { fireEvent, render, within } from '@testing-library/react-native';

import { KnowledgeDetailScreen } from '../KnowledgeDetailScreen';
import { getKnowledgeBase, listDocuments } from '../../apiClient';
import { document, knowledge } from '../../testing/fixtures';

jest.mock('../../apiClient');
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));

describe('KnowledgeDetailScreen', () => {
  beforeEach(() => {
    jest.mocked(getKnowledgeBase).mockResolvedValue(knowledge);
    jest.mocked(listDocuments).mockResolvedValue({ items: [document] });
  });

  it('loads documents, filters, and opens ready content', async () => {
    const onOpenDocument = jest.fn();
    const screen = render(<KnowledgeDetailScreen knowledgeId={knowledge.id} onBack={jest.fn()} onOpenDocument={onOpenDocument} />);
    expect(await screen.findByText('用户研究执行计划')).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText('搜索文档...'), '执行计划');
    fireEvent.press(screen.getByLabelText('打开文件：用户研究执行计划'));
    expect(onOpenDocument).toHaveBeenCalledWith(document.id);
  });

  it('opens the grounded query page', async () => {
    const onAsk = jest.fn();
    const screen = render(<KnowledgeDetailScreen knowledgeId={knowledge.id} onAsk={onAsk} onBack={jest.fn()} onOpenDocument={jest.fn()} />);
    await screen.findByText('问知识库');
    fireEvent.press(screen.getByText('问知识库'));
    expect(onAsk).toHaveBeenCalled();
  });

  it('keeps the associate-group action outside the group scroll content', async () => {
    const screen = render(<KnowledgeDetailScreen knowledgeId={knowledge.id} onBack={jest.fn()} onOpenDocument={jest.fn()} />);
    await screen.findByText('暂无关联分组');

    expect(within(screen.getByTestId('knowledge-groups-fixed-action')).getByText('关联新分组')).toBeTruthy();
    expect(within(screen.getByTestId('knowledge-files-scroll')).queryByText('关联新分组')).toBeNull();
  });
});
