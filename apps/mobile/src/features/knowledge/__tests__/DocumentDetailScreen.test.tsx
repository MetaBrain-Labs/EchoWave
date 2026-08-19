import { fireEvent, render } from '@testing-library/react-native';

import { DocumentDetailScreen } from '../DocumentDetailScreen';
import { getDocument } from '../apiClient';
import { document, knowledge } from '../testFixtures';

jest.mock('../apiClient');

describe('DocumentDetailScreen', () => {
  beforeEach(() => jest.mocked(getDocument).mockResolvedValue(document));

  it('loads, filters, and opens a parsed chunk', async () => {
    const onOpenBlock = jest.fn();
    const screen = render(<DocumentDetailScreen documentId={document.id} knowledgeId={knowledge.id} onBack={jest.fn()} onOpenBlock={onOpenBlock} />);
    expect(await screen.findByText('块 1 · 研究背景')).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText('搜索文本块...'), '核心需求');
    expect(screen.queryByText('块 1 · 研究背景')).toBeNull();
    fireEvent.press(screen.getByLabelText('打开文本块：核心需求'));
    expect(onOpenBlock).toHaveBeenCalledWith(document.chunks[1]?.id);
  });

  it('shows the normalized source preview', async () => {
    const screen = render(<DocumentDetailScreen documentId={document.id} knowledgeId={knowledge.id} onBack={jest.fn()} onOpenBlock={jest.fn()} />);
    await screen.findByText('文档原文');
    fireEvent.press(screen.getByText('文档原文'));
    expect(screen.getByText(document.previewText)).toBeTruthy();
  });
});
