/**
 * 服务配置页面测试。
 *
 * 验证管理员校验、ASR 默认上下文读写与服务器配置入口。
 *
 * Responsibilities:
 * - 锁定口令校验成功后进入已校验状态且不再显示输入框。
 * - 锁定 ASR 保存使用共享会话口令，并在 UNAUTHORIZED 时回到未校验状态。
 *
 * Notes:
 * - 所有 API 都使用内存替身，不发起网络请求。
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { getAsrPreferences, updateAsrPreferences } from '@/shared/api/asrPreferencesApi';
import { WorkspaceRequestError } from '@/shared/api/request';
import { settingsApi } from '@/shared/api/settingsApi';
import { AdminSessionProvider } from '@/shared/auth/AdminSessionProvider';
import { ServiceConfigurationScreen } from '../ServiceConfigurationScreen';

jest.mock('@/shared/api/asrPreferencesApi', () => ({
  getAsrPreferences: jest.fn(),
  updateAsrPreferences: jest.fn(),
}));
jest.mock('@/shared/api/settingsApi', () => ({
  settingsApi: { verify: jest.fn() },
}));

const mockedGetAsr = jest.mocked(getAsrPreferences);
const mockedUpdateAsr = jest.mocked(updateAsrPreferences);
const mockedVerify = jest.mocked(settingsApi.verify);

const props = {
  onBack: jest.fn(),
  onOpenAi: jest.fn(),
  onOpenRuntime: jest.fn(),
};

function renderScreen() {
  return render(
    <AdminSessionProvider serverRevision={0}>
      <ServiceConfigurationScreen {...props} />
    </AdminSessionProvider>,
  );
}

describe('ServiceConfigurationScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockedGetAsr.mockResolvedValue({ defaultContext: '售后回访', revision: 2 });
    mockedVerify.mockResolvedValue({ ok: true });
    mockedUpdateAsr.mockResolvedValue({ defaultContext: '售后回访', revision: 3 });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('verifies the administrator token once and hides the input afterwards', async () => {
    const screen = renderScreen();

    expect(await screen.findByDisplayValue('售后回访')).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText('管理员口令'), 'admin-token');
    fireEvent.press(screen.getByText('校验口令'));

    await waitFor(() => expect(mockedVerify).toHaveBeenCalledWith('admin-token'));
    expect(screen.queryByLabelText('管理员口令')).toBeNull();
    expect(screen.getByText(/已通过管理员校验/)).toBeTruthy();
  });

  it('saves the tenant ASR context with the shared session token and revision', async () => {
    const screen = renderScreen();
    await screen.findByDisplayValue('售后回访');
    fireEvent.changeText(screen.getByLabelText('管理员口令'), 'admin-token');
    // 校验是异步的：在 act 内等待完成，避免共享会话的写入逃出测试的刷新边界。
    await act(async () => {
      fireEvent.press(screen.getByText('校验口令'));
    });
    expect(screen.queryByLabelText('管理员口令')).toBeNull();

    fireEvent.changeText(screen.getByLabelText('默认上下文（可选）'), '新上下文');
    fireEvent.press(screen.getByText('保存默认上下文'));

    await waitFor(() =>
      expect(mockedUpdateAsr).toHaveBeenCalledWith(
        { defaultContext: '新上下文', expectedRevision: 2 },
        'admin-token',
      ),
    );
    expect(Alert.alert).toHaveBeenCalledWith('默认上下文已保存。');
  });

  it('clears the shared session when the server rejects the token', async () => {
    mockedUpdateAsr.mockRejectedValueOnce(
      new WorkspaceRequestError('UNAUTHORIZED', '管理口令无效。'),
    );
    const screen = renderScreen();
    await screen.findByDisplayValue('售后回访');
    fireEvent.changeText(screen.getByLabelText('管理员口令'), 'admin-token');
    await act(async () => {
      fireEvent.press(screen.getByText('校验口令'));
    });
    expect(screen.queryByLabelText('管理员口令')).toBeNull();

    fireEvent.press(screen.getByText('保存默认上下文'));

    await waitFor(() => expect(screen.getByLabelText('管理员口令')).toBeTruthy());
    expect(Alert.alert).toHaveBeenCalledWith('保存失败，请检查管理员口令或刷新后重试。');
  });

  it('keeps the invalid token out of the session and reports the failure', async () => {
    mockedVerify.mockRejectedValueOnce(new Error('unauthorized'));
    const screen = renderScreen();
    await screen.findByDisplayValue('售后回访');

    fireEvent.changeText(screen.getByLabelText('管理员口令'), 'wrong-token');
    fireEvent.press(screen.getByText('校验口令'));

    await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('管理员口令无效或已变更。'));
    expect(screen.getByLabelText('管理员口令')).toBeTruthy();
  });

  it('opens AI configuration and runtime mode entries', async () => {
    const screen = renderScreen();
    await screen.findByDisplayValue('售后回访');

    fireEvent.press(screen.getByLabelText('AI 配置'));
    expect(props.onOpenAi).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByLabelText('运行模式'));
    expect(props.onOpenRuntime).toHaveBeenCalledTimes(1);
  });
});
