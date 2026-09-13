/**
 * 文档版本编辑交互回归。
 *
 * 验证确认删除、改名预期版本、冲突和文件选择取消不会提交修改。
 *
 * Responsibilities:
 * - 验证知识生命周期的用户交互与失败恢复。
 *
 * Notes:
 * - 仅使用固定固件和模拟 API，不连接真实服务。
 */
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { pickDocumentAsync } from '@/shared/files/documentPicker';
import { document as documentFixture } from '../../testing/fixtures';
import { deleteDocument, getDocument, renameDocument, uploadDocument } from '../../apiClient';
import { KnowledgeDocumentEditor } from '../KnowledgeDocumentEditor';
jest.mock('../../apiClient');
jest.mock('@/shared/files/documentPicker');
describe('KnowledgeDocumentEditor', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });
  const setup = () => {
    const onChanged = jest.fn();
    const onClose = jest.fn();
    return {
      onChanged,
      onClose,
      screen: render(
        <KnowledgeDocumentEditor
          document={{ ...documentFixture, version: 3 }}
          knowledgeId={documentFixture.knowledgeBaseId}
          onClose={onClose}
          onChanged={onChanged}
          onOpen={jest.fn()}
        />,
      ),
    };
  };
  it('only deletes after an explicit confirmation', async () => {
    const { screen } = setup();
    fireEvent.press(screen.getByText('删除文件'));
    expect(deleteDocument).not.toHaveBeenCalled();
    fireEvent.press(screen.getByText('确认'));
    await waitFor(() =>
      expect(deleteDocument).toHaveBeenCalledWith(
        documentFixture.knowledgeBaseId,
        documentFixture.id,
      ),
    );
  });
  it('submits the observed version when renaming', async () => {
    const { screen } = setup();
    fireEvent.press(screen.getByText('修改文件名'));
    fireEvent.changeText(screen.getByLabelText('文件名'), '新版.md');
    fireEvent.press(screen.getByText('确认'));
    await waitFor(() =>
      expect(renameDocument).toHaveBeenCalledWith(
        documentFixture.knowledgeBaseId,
        documentFixture.id,
        '新版.md',
        3,
      ),
    );
  });
  it('refreshes a conflict without automatically resubmitting', async () => {
    jest
      .mocked(renameDocument)
      .mockRejectedValue(Object.assign(new Error('conflict'), { code: 'CONFLICT' }));
    jest.mocked(getDocument).mockResolvedValue({ ...documentFixture, version: 4 });
    const { screen, onChanged } = setup();
    fireEvent.press(screen.getByText('修改文件名'));
    fireEvent.press(screen.getByText('确认'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(renameDocument).toHaveBeenCalledTimes(1);
  });
  it('confirms a timed-out deletion by reading the server before allowing another request', async () => {
    jest
      .mocked(deleteDocument)
      .mockRejectedValue(Object.assign(new Error('timeout'), { code: 'TIMEOUT' }));
    jest
      .mocked(getDocument)
      .mockRejectedValue(Object.assign(new Error('missing'), { code: 'NOT_FOUND' }));
    const { screen, onClose, onChanged } = setup();
    fireEvent.press(screen.getByText('删除文件'));
    fireEvent.press(screen.getByText('确认'));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(getDocument).toHaveBeenCalledTimes(1);
    expect(deleteDocument).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
  it('confirms an accepted rename after a timeout without resubmitting', async () => {
    jest
      .mocked(renameDocument)
      .mockRejectedValue(Object.assign(new Error('timeout'), { code: 'TIMEOUT' }));
    jest
      .mocked(getDocument)
      .mockResolvedValue({ ...documentFixture, version: 4, title: '新名称.md' });
    const { screen, onClose } = setup();
    fireEvent.press(screen.getByText('修改文件名'));
    fireEvent.changeText(screen.getByLabelText('文件名'), '新名称.md');
    fireEvent.press(screen.getByText('确认'));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(renameDocument).toHaveBeenCalledTimes(1);
    expect(getDocument).toHaveBeenCalledTimes(1);
  });
  it('preserves rename input after an API failure', async () => {
    jest.mocked(renameDocument).mockRejectedValue(new Error('服务暂不可用'));
    const { screen, onClose } = setup();
    fireEvent.press(screen.getByText('修改文件名'));
    fireEvent.changeText(screen.getByLabelText('文件名'), '等待提交.md');
    fireEvent.press(screen.getByText('确认'));
    await waitFor(() => expect(screen.getByText('服务暂不可用')).toBeTruthy());
    expect(screen.getByDisplayValue('等待提交.md')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
  it('does not upload a canceled replacement', async () => {
    jest.mocked(pickDocumentAsync).mockResolvedValue({ canceled: true, assets: null });
    const { screen, onClose } = setup();
    fireEvent.press(screen.getByText('替换文件'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(uploadDocument).not.toHaveBeenCalled();
  });
});
