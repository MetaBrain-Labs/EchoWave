/**
 * AI 配置中心交互测试。
 *
 * 锁定远程 HTTP 提示、Secret 禁用与 Local alias 可选行为。
 *
 * Responsibilities:
 * - 验证页面不信任客户端推测的连接安全性。
 * - 验证不安全连接仍能进入普通配置界面。
 *
 * Notes:
 * - 所有 API 都使用内存替身，不发起网络请求。
 */
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { settingsApi } from '@/shared/api/settingsApi';
import { WorkspaceRequestError } from '@/shared/api/request';
import { SettingsScreen } from '../SettingsScreen';

jest.mock('@/shared/api/settingsApi', () => ({
  settingsApi: {
    transport: jest.fn(),
    verify: jest.fn(),
    overview: jest.fn(),
    createProvider: jest.fn(),
    updateProvider: jest.fn(),
    saveCapability: jest.fn(),
    importLegacy: jest.fn(),
  },
}));

const mockedApi = jest.mocked(settingsApi);

describe('SettingsScreen', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockedApi.transport.mockResolvedValue({
      mode: 'insecure_remote_http',
      secretSubmissionAllowed: false,
      warning: 'insecure',
    });
    mockedApi.verify.mockResolvedValue({ ok: true });
    mockedApi.overview.mockResolvedValue({
      transport: {
        mode: 'insecure_remote_http',
        secretSubmissionAllowed: false,
        warning: 'insecure',
      },
      localCredentials: {
        configured: true,
        healthy: true,
        lastLoadedAt: '2026-09-01T00:00:00.000Z',
        error: null,
        credentials: [{ alias: 'dashscope-main', type: 'dashscope', available: true }],
      },
      providers: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          type: 'dashscope',
          name: '主连接',
          revision: 1,
          config: {
            baseUrl: 'https://dashscope.aliyuncs.com',
            compatibleBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            asyncNotifyMode: 'polling',
            eventBridgeCallbackUrl: null,
          },
          credential: {
            source: 'database',
            configured: true,
            alias: null,
            maskedValue: '***abcd',
          },
          updatedAt: '2026-09-01T00:00:00.000Z',
        },
      ],
      bindings: [],
      legacy: { detectedVariables: [], missingVariables: [], ready: false, importedAt: null },
    });
  });

  it('disables Secret entry but keeps Local alias configuration available on remote HTTP', async () => {
    const screen = render(<SettingsScreen onBack={jest.fn()} />);

    await waitFor(() =>
      expect(
        screen.getByText(
          '当前连接不是 HTTPS，不能通过此页面提交 Credential。请在服务器本地配置 credentials.yaml，然后选择对应的 Local Credential alias。',
        ),
      ).toBeTruthy(),
    );
    fireEvent.changeText(screen.getByLabelText('CONFIGURATION_ADMIN_TOKEN'), 'admin-token');
    fireEvent.press(screen.getByText('进入配置中心'));

    await waitFor(() => expect(screen.getByText('dashscope-main · DashScope · 可用')).toBeTruthy());
    fireEvent.press(screen.getByText('修改'));
    expect(screen.getByLabelText('API Key').props.editable).toBe(false);
    expect(screen.getByText(/dashscope-main/)).toBeTruthy();
  });

  it('updates ordinary Database connection fields without submitting a Credential on remote HTTP', async () => {
    mockedApi.updateProvider.mockResolvedValue({
      ...(await mockedApi.overview('admin-token')).providers[0]!,
      name: '更新后的连接',
      revision: 2,
    });
    const screen = render(<SettingsScreen onBack={jest.fn()} />);
    fireEvent.changeText(screen.getByLabelText('CONFIGURATION_ADMIN_TOKEN'), 'admin-token');
    fireEvent.press(screen.getByText('进入配置中心'));

    await waitFor(() => expect(screen.getByText('修改')).toBeTruthy());
    fireEvent.press(screen.getByText('修改'));
    fireEvent.changeText(screen.getByLabelText('名称'), '更新后的连接');
    fireEvent.press(screen.getByText('保存修改'));

    await waitFor(() =>
      expect(mockedApi.updateProvider).toHaveBeenCalledWith(
        'admin-token',
        '11111111-1111-4111-8111-111111111111',
        expect.objectContaining({
          name: '更新后的连接',
          credentialSource: 'database',
          expectedRevision: 1,
        }),
      ),
    );
    const submitted = mockedApi.updateProvider.mock.calls[0]?.[2];
    expect(submitted).not.toHaveProperty('credential');
  });

  it('returns to the in-memory login gate after an unauthorized refresh', async () => {
    mockedApi.overview.mockRejectedValueOnce(
      new WorkspaceRequestError('UNAUTHORIZED', '管理口令无效。'),
    );
    const screen = render(<SettingsScreen onBack={jest.fn()} />);
    fireEvent.changeText(screen.getByLabelText('CONFIGURATION_ADMIN_TOKEN'), 'expired-token');
    fireEvent.press(screen.getByText('进入配置中心'));

    await waitFor(() => expect(screen.getByText('管理员口令无效或已变更。')).toBeTruthy());
    expect(screen.getByLabelText('CONFIGURATION_ADMIN_TOKEN')).toBeTruthy();
  });
});
