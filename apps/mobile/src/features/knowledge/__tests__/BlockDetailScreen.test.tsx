import { fireEvent, render } from '@testing-library/react-native';

import { BlockDetailScreen } from '../BlockDetailScreen';
import { resetImportantBlockIds } from '../preferences';

describe('BlockDetailScreen', () => {
  const props = {
    blockId: 'block-background',
    documentId: 'doc-interview-workflow',
    knowledgeId: 'kb-1',
    onBack: jest.fn(),
    onLocateOriginal: jest.fn(),
    onNavigateBlock: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    resetImportantBlockIds();
  });

  it('shows block/source content and handles next and source navigation', () => {
    const screen = render(<BlockDetailScreen {...props} />);

    expect(screen.getByText('1/4')).toBeTruthy();
    expect(screen.getAllByText('来源位置：第 1 页 第 3 行')).toHaveLength(2);
    expect(screen.getByRole('button', { name: '上一块' }).props.accessibilityState).toEqual({
      disabled: true,
    });

    fireEvent.press(screen.getByRole('button', { name: '下一块' }));
    expect(props.onNavigateBlock).toHaveBeenCalledWith('block-process');
    fireEvent.press(screen.getByText('定位原文'));
    expect(props.onLocateOriginal).toHaveBeenCalledWith('block-background');
  });

  it('shares an emphasis choice with the session preference store', () => {
    const screen = render(<BlockDetailScreen {...props} />);
    fireEvent.press(screen.getByText('设为重点'));
    expect(screen.getByText('取消重点')).toBeTruthy();
  });

  it('renders a recoverable unknown-block state', () => {
    const screen = render(<BlockDetailScreen {...props} blockId="missing" />);
    expect(screen.getByText('未找到文本块')).toBeTruthy();
  });
});
