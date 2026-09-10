/**
 * AI 配置中心交互测试。
 *
 * 锁定远程 HTTP 提示、连接表单、默认能力绑定、输入框样式与内联编辑行为。
 *
 * Responsibilities:
 * - 验证页面不信任客户端推测的连接安全性。
 * - 验证不安全连接仍能进入普通配置界面。
 * - 验证批量默认绑定不覆盖已有配置并公开部分失败结果。
 *
 * Notes:
 * - 所有 API 都使用内存替身，不发起网络请求。
 */
import { fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { settingsApi } from '@/shared/api/settingsApi';
import { WorkspaceRequestError } from '@/shared/api/request';
import { SettingsScreen } from '../SettingsScreen';

jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));

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

async function enterConfigurationCenter(screen: ReturnType<typeof render>) {
  fireEvent.changeText(screen.getByLabelText('CONFIGURATION_ADMIN_TOKEN'), 'admin-token');
  fireEvent.press(screen.getByText('进入配置中心'));
  await waitFor(() => expect(screen.getByText('默认能力配置')).toBeTruthy());
}

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

  it('keeps the provider editor collapsed until adding or editing a connection', async () => {
    const screen = render(<SettingsScreen onBack={jest.fn()} />);
    await enterConfigurationCenter(screen);

    expect(screen.queryByLabelText('名称')).toBeNull();
    fireEvent.press(screen.getByLabelText('添加连接'));
    expect(screen.getByLabelText('名称')).toBeTruthy();
    expect(screen.getByLabelText('收起连接表单').props.accessibilityState).toEqual({
      expanded: true,
    });
    fireEvent.press(screen.getByLabelText('收起连接表单'));
    expect(screen.queryByLabelText('名称')).toBeNull();

    fireEvent.press(screen.getByText('修改'));
    expect(screen.getByLabelText('名称').props.value).toBe('主连接');
    fireEvent.press(screen.getByText('取消修改'));
    expect(screen.queryByLabelText('名称')).toBeNull();
  });

  it('uses stable single-line input metrics and the standard app radius', async () => {
    const screen = render(<SettingsScreen onBack={jest.fn()} />);
    await enterConfigurationCenter(screen);
    fireEvent.press(screen.getByLabelText('添加连接'));

    expect(StyleSheet.flatten(screen.getByLabelText('名称').props.style)).toEqual(
      expect.objectContaining({
        height: 44,
        includeFontPadding: false,
        paddingVertical: 0,
        textAlignVertical: 'center',
      }),
    );
    expect(StyleSheet.flatten(screen.getByLabelText('Local file').props.style)).toEqual(
      expect.objectContaining({ borderRadius: 4 }),
    );
  });

  it('renders the active binding editor directly below its capability row and toggles it', async () => {
    const screen = render(<SettingsScreen onBack={jest.fn()} />);
    await enterConfigurationCenter(screen);

    const embeddingRow = screen.getByTestId('capability-row-knowledge_embedding');
    fireEvent.press(embeddingRow);
    const embeddingItem = within(screen.getByTestId('capability-item-knowledge_embedding'));
    expect(embeddingItem.getByTestId('capability-row-knowledge_embedding')).toBeTruthy();
    expect(embeddingItem.getByTestId('capability-editor-knowledge_embedding')).toBeTruthy();
    expect(screen.getByText('qwen3.7-text-embedding')).toBeTruthy();

    fireEvent.press(embeddingRow);
    expect(screen.queryByTestId('capability-editor-knowledge_embedding')).toBeNull();
    fireEvent.press(screen.getByTestId('capability-row-audio_transcription'));
    expect(screen.getByTestId('capability-editor-audio_transcription')).toBeTruthy();
    expect(screen.queryByTestId('capability-editor-knowledge_embedding')).toBeNull();
  });

  it('requires an explicit choice when multiple connections have the same type', async () => {
    const overview = await mockedApi.overview('admin-token');
    mockedApi.overview.mockResolvedValue({
      ...overview,
      providers: [
        ...overview.providers,
        {
          ...overview.providers[0]!,
          id: '22222222-2222-4222-8222-222222222222',
          name: '备用连接',
        },
      ],
    });
    mockedApi.overview.mockClear();
    const screen = render(<SettingsScreen onBack={jest.fn()} />);
    await enterConfigurationCenter(screen);

    expect(screen.getByLabelText('应用默认配置（0 项）')).toBeDisabled();
    fireEvent.press(screen.getByLabelText('主连接'));
    expect(screen.getByLabelText('应用默认配置（3 项）')).not.toBeDisabled();
  });

  it('applies only missing defaults and reports skipped and failed capabilities', async () => {
    const overview = await mockedApi.overview('admin-token');
    mockedApi.overview.mockResolvedValue({
      ...overview,
      bindings: [
        {
          capability: 'knowledge_embedding',
          providerConnectionId: overview.providers[0]!.id,
          secondaryProviderConnectionId: null,
          model: 'qwen3.7-text-embedding',
          settings: {},
          revision: 1,
          updatedAt: '2026-09-01T00:00:00.000Z',
        },
      ],
    });
    mockedApi.overview.mockClear();
    mockedApi.saveCapability.mockImplementation(async (_token, capability, input) => {
      if (capability === 'audio_emotion') throw new Error('provider failed');
      return {
        capability,
        ...input,
        revision: 1,
        updatedAt: '2026-09-01T00:00:00.000Z',
      };
    });
    const screen = render(<SettingsScreen onBack={jest.fn()} />);
    await enterConfigurationCenter(screen);

    fireEvent.press(screen.getByText('应用默认配置（2 项）'));
    await waitFor(() => expect(mockedApi.saveCapability).toHaveBeenCalledTimes(2));
    expect(mockedApi.saveCapability).not.toHaveBeenCalledWith(
      'admin-token',
      'knowledge_embedding',
      expect.anything(),
    );
    expect(mockedApi.saveCapability).toHaveBeenCalledWith('admin-token', 'audio_transcription', {
      providerConnectionId: overview.providers[0]!.id,
      secondaryProviderConnectionId: null,
      model: 'qwen-audio-3.0-asr-flash-filetrans',
      settings: {},
    });
    await waitFor(() =>
      expect(
        screen.getByText(/已应用 1 项，跳过 6 项，失败 1 项。.*失败能力：情绪分析/),
      ).toBeTruthy(),
    );
    expect(mockedApi.overview).toHaveBeenCalledTimes(2);
  });
});
