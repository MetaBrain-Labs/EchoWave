import { fireEvent, render } from '@testing-library/react-native';
import { Alert, StyleSheet } from 'react-native';

import { KnowledgeListScreen } from '../KnowledgeListScreen';

describe('KnowledgeListScreen', () => {
  it('renders local knowledge cards and opens the selected library', () => {
    const onOpenKnowledge = jest.fn();
    const screen = render(<KnowledgeListScreen onOpenKnowledge={onOpenKnowledge} />);

    expect(screen.getByText('产品研究知识库')).toBeTruthy();
    expect(screen.getByText('6 份文档 · 关联 3 个分组')).toBeTruthy();
    expect(
      StyleSheet.flatten(screen.getByText('产品研究知识库').props.style),
    ).toEqual(expect.objectContaining({ fontSize: 16, lineHeight: 24 }));
    expect(
      StyleSheet.flatten(
        screen.getByLabelText('打开知识库：产品研究知识库').props.style,
      ),
    ).toEqual(expect.objectContaining({ padding: 16 }));

    fireEvent.press(screen.getByLabelText('打开知识库：产品研究知识库'));
    expect(onOpenKnowledge).toHaveBeenCalledWith('kb-1');
  });

  it('uses explicit feedback for unimplemented actions', () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const screen = render(<KnowledgeListScreen onOpenKnowledge={jest.fn()} />);

    fireEvent.press(screen.getByText('新建'));
    expect(alert).toHaveBeenCalledWith(
      '功能建设中',
      '新建知识库将在后续版本开放。',
    );
    alert.mockRestore();
  });
});
