/**
 * 知识库 metadata 编辑回归。
 *
 * 验证保存名称描述、失败保留草稿和重新打开时恢复服务器值。
 *
 * Responsibilities:
 * - 验证知识生命周期的用户交互与失败恢复。
 *
 * Notes:
 * - 仅使用固定固件和模拟 API，不连接真实服务。
 */
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { updateKnowledgeBase } from '../../apiClient';
import { knowledge } from '../../testing/fixtures';
import { KnowledgeBaseEditor } from '../KnowledgeBaseEditor';

jest.mock('../../apiClient');

describe('KnowledgeBaseEditor', () => {
  beforeEach(() => jest.resetAllMocks());
  it('submits metadata without starting document processing', async () => {
    jest.mocked(updateKnowledgeBase).mockResolvedValue(knowledge);
    const onSaved = jest.fn();
    const screen = render(
      <KnowledgeBaseEditor knowledge={knowledge} visible onClose={jest.fn()} onSaved={onSaved} />,
    );
    fireEvent.changeText(screen.getByLabelText('知识库名称'), '新知识库名称');
    fireEvent.changeText(screen.getByLabelText('描述'), '新的描述');
    fireEvent.press(screen.getByText('确认'));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(updateKnowledgeBase).toHaveBeenCalledWith(knowledge.id, '新知识库名称', '新的描述');
  });
  it('keeps a failed draft and discards it when closed', async () => {
    jest.mocked(updateKnowledgeBase).mockRejectedValue(new Error('保存失败'));
    const props = { knowledge, onClose: jest.fn(), onSaved: jest.fn() };
    const screen = render(<KnowledgeBaseEditor {...props} visible />);
    fireEvent.changeText(screen.getByLabelText('知识库名称'), '未保存的名称');
    fireEvent.press(screen.getByText('确认'));
    await waitFor(() => expect(screen.getByText('保存失败')).toBeTruthy());
    expect(screen.getByDisplayValue('未保存的名称')).toBeTruthy();
    expect(props.onClose).not.toHaveBeenCalled();
    screen.rerender(<KnowledgeBaseEditor {...props} visible={false} />);
    screen.rerender(<KnowledgeBaseEditor {...props} visible />);
    expect(screen.getByDisplayValue(knowledge.name)).toBeTruthy();
  });
});
