import { fireEvent, render } from '@testing-library/react-native';

import { BlockDetailScreen } from '../BlockDetailScreen';
import { getDocument } from '../apiClient';
import { document, knowledge } from '../testFixtures';

jest.mock('../apiClient');

describe('BlockDetailScreen', () => {
  beforeEach(() => jest.mocked(getDocument).mockResolvedValue(document));

  it('shows a real source locator and navigates adjacent chunks', async () => {
    const onNavigateBlock = jest.fn();
    const screen = render(<BlockDetailScreen blockId={document.chunks[0]!.id} documentId={document.id} knowledgeId={knowledge.id} onBack={jest.fn()} onLocateOriginal={jest.fn()} onNavigateBlock={onNavigateBlock} />);
    expect(await screen.findByText('研究背景，第 3-5 行')).toBeTruthy();
    fireEvent.press(screen.getByText('下一块'));
    expect(onNavigateBlock).toHaveBeenCalledWith(document.chunks[1]?.id);
  });

  it('keeps the requested citation chunk highlighted as the only content card', async () => {
    const screen = render(<BlockDetailScreen blockId={document.chunks[1]!.id} documentId={document.id} knowledgeId={knowledge.id} onBack={jest.fn()} onLocateOriginal={jest.fn()} onNavigateBlock={jest.fn()} />);
    expect(await screen.findByText('回答需要关联原始证据。')).toBeTruthy();
  });
});
