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
import type { ReactElement } from 'react';
import { StyleSheet, Text } from 'react-native';

import { settingsApi } from '@/shared/api/settingsApi';
import { WorkspaceRequestError } from '@/shared/api/request';
import { AdminSessionProvider, useAdminSession } from '@/shared/auth/AdminSessionProvider';
import {
  StarterTourContext,
  type StarterTourContextValue,
} from '@/shared/onboarding/StarterTourContext';
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

/** 通过真实上下文写入共享会话，模拟用户已在“服务配置”完成校验。 */
function SeedSession({ token }: { token: string }) {
  const { setSession } = useAdminSession();
  return (
    <Text accessibilityRole="button" onPress={() => setSession(token)}>
      建立共享会话
    </Text>
  );
}

/** 在共享会话内渲染 AI 配置页；authorized 为 false 时保持未校验状态。 */
function renderWithSession(node: ReactElement, { authorized = true } = {}) {
  const screen = render(
    <AdminSessionProvider serverRevision={0}>
      {authorized ? <SeedSession token="admin-token" /> : null}
      {node}
    </AdminSessionProvider>,
  );
  if (authorized) fireEvent.press(screen.getByText('建立共享会话'));
  return screen;
}

async function enterConfigurationCenter(screen: ReturnType<typeof render>) {
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
            baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
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

  it('renders the AI guide demo without requesting or saving real configuration', async () => {
    const context: StarterTourContextValue = {
      activeGuide: 'ai_configuration',
      activeStep: 'ai-demo-notice',
      offerStarterTemplates: jest.fn(),
      registerTarget: jest.fn(),
      replay: jest.fn(),
      startGuide: jest.fn(),
      statuses: {
        basic: 'not_started',
        knowledge: 'not_started',
        knowledge_query: 'not_started',
        data_sources: 'not_started',
        group_settings: 'not_started',
        knowledge_collection: 'not_started',
        ai_configuration: 'not_started',
        runtime_mode: 'not_started',
        analysis: 'not_started',
      },
      templates: {},
    };
    const screen = renderWithSession(
      <StarterTourContext.Provider value={context}>
        <SettingsScreen onBack={jest.fn()} onOpenServiceConfiguration={jest.fn()} />
      </StarterTourContext.Provider>,
    );
    await waitFor(() => expect(screen.getByTestId('ai-configuration-guide-demo')).toBeTruthy());
    expect(screen.getByTestId('ai-configuration-guide-demo')).toBeTruthy();
    expect(screen.getByText('仅用于引导演示，不是实际配置')).toBeTruthy();
    expect(screen.getByText(/LdFu/)).toBeTruthy();
    // 演示区域不触发任何真实保存请求。
    expect(mockedApi.saveCapability).not.toHaveBeenCalled();
    expect(mockedApi.createProvider).not.toHaveBeenCalled();
    expect(mockedApi.importLegacy).not.toHaveBeenCalled();
  });

  it('disables Secret entry but keeps Local alias configuration available on remote HTTP', async () => {
    const screen = renderWithSession(
      <SettingsScreen onBack={jest.fn()} onOpenServiceConfiguration={jest.fn()} />,
    );

    await waitFor(() =>
      expect(
        screen.getByText(
          '当前连接不是 HTTPS，不能通过此页面提交 Credential。请在服务器本地配置 credentials.yaml，然后选择对应的 Local Credential alias。',
        ),
      ).toBeTruthy(),
    );

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
    const screen = renderWithSession(
      <SettingsScreen onBack={jest.fn()} onOpenServiceConfiguration={jest.fn()} />,
    );

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

  it('falls back to the shared-session gate after an unauthorized refresh', async () => {
    mockedApi.overview.mockRejectedValueOnce(
      new WorkspaceRequestError('UNAUTHORIZED', '管理口令无效。'),
    );
    const onOpenServiceConfiguration = jest.fn();
    const screen = renderWithSession(
      <SettingsScreen onBack={jest.fn()} onOpenServiceConfiguration={onOpenServiceConfiguration} />,
    );

    // 共享会话失效后不再要求在本页重复输入口令，而是给出唯一校验入口。
    await waitFor(() => expect(screen.getByText('需要管理员校验')).toBeTruthy());
    expect(screen.queryByLabelText('CONFIGURATION_ADMIN_TOKEN')).toBeNull();
    fireEvent.press(screen.getByLabelText('前往服务配置校验'));
    expect(onOpenServiceConfiguration).toHaveBeenCalledTimes(1);
  });

  it('keeps the provider editor collapsed until adding or editing a connection', async () => {
    const screen = renderWithSession(
      <SettingsScreen onBack={jest.fn()} onOpenServiceConfiguration={jest.fn()} />,
    );
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

  it('uses provider-specific defaults and clears switched fields while preserving connection identity', async () => {
    mockedApi.updateProvider.mockResolvedValue({
      ...(await mockedApi.overview('admin-token')).providers[0]!,
      type: 'deepseek',
      revision: 2,
    });
    const screen = renderWithSession(
      <SettingsScreen onBack={jest.fn()} onOpenServiceConfiguration={jest.fn()} />,
    );
    await enterConfigurationCenter(screen);

    fireEvent.press(screen.getByText('修改'));
    fireEvent.changeText(
      screen.getByLabelText('Base URL（必须为公网 HTTPS）'),
      'https://example.invalid/custom',
    );
    fireEvent.press(screen.getByLabelText('DeepSeek'));

    expect(screen.getByLabelText('名称').props.value).toBe('主连接');
    expect(screen.getByLabelText('Base URL（必须为公网 HTTPS）').props.value).toBe(
      'https://api.deepseek.com',
    );
    expect(screen.queryByLabelText('Compatible Base URL')).toBeNull();

    fireEvent.press(screen.getByText('保存修改'));
    await waitFor(() =>
      expect(mockedApi.updateProvider).toHaveBeenCalledWith(
        'admin-token',
        '11111111-1111-4111-8111-111111111111',
        expect.objectContaining({
          type: 'deepseek',
          name: '主连接',
          config: { baseUrl: 'https://api.deepseek.com' },
          credentialSource: 'database',
          expectedRevision: 1,
        }),
      ),
    );

    fireEvent.press(screen.getByText('修改'));
    fireEvent.press(screen.getByLabelText('DashScope'));
    expect(screen.getByLabelText('Base URL（必须为公网 HTTPS）').props.value).toBe(
      'https://dashscope.aliyuncs.com/api/v1',
    );
    expect(screen.getByLabelText('Compatible Base URL').props.value).toBe(
      'https://dashscope.aliyuncs.com/compatible-mode/v1',
    );
  });

  it('uses stable single-line input metrics and the standard app radius', async () => {
    const screen = renderWithSession(
      <SettingsScreen onBack={jest.fn()} onOpenServiceConfiguration={jest.fn()} />,
    );
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
    const screen = renderWithSession(
      <SettingsScreen onBack={jest.fn()} onOpenServiceConfiguration={jest.fn()} />,
    );
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
    const screen = renderWithSession(
      <SettingsScreen onBack={jest.fn()} onOpenServiceConfiguration={jest.fn()} />,
    );
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
    const screen = renderWithSession(
      <SettingsScreen onBack={jest.fn()} onOpenServiceConfiguration={jest.fn()} />,
    );
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
