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
    modelCatalog: jest.fn(),
    createProvider: jest.fn(),
    updateProvider: jest.fn(),
    saveCapability: jest.fn(),
    importLegacy: jest.fn(),
  },
}));

const mockedApi = jest.mocked(settingsApi);

/** 构造服务端按能力责任过滤后的目录响应，第一项即置顶的已验证默认模型。 */
function catalogResponse(
  capability: string,
  providers: {
    connectionId: string;
    providerType: 'dashscope' | 'deepseek';
    name: string;
    models: string[];
    catalogAvailable?: boolean;
    /** 缺省时取首个模型；显式传 null 表示该连接不提供该能力的默认模型。 */
    defaultModel?: string | null;
  }[],
) {
  return {
    capability,
    providers: providers.map((provider) => ({
      connectionId: provider.connectionId,
      providerType: provider.providerType,
      name: provider.name,
      catalogAvailable: provider.catalogAvailable ?? true,
      unavailableReason:
        provider.catalogAvailable === false ? '暂时无法读取该供应商的模型列表，请稍后重试。' : null,
      defaultModel:
        provider.defaultModel === undefined ? (provider.models[0] ?? null) : provider.defaultModel,
      models: provider.models.map((id, index) => ({
        id,
        displayName: id,
        description: '',
        capabilities: [],
        features: [],
        contextWindow: null,
        maxOutputTokens: null,
        outputDimensions: id.includes('embedding') ? 1024 : null,
        pricing:
          id === 'qwen3-max'
            ? {
                currency: 'CNY' as const,
                entries: [
                  {
                    type: 'input_token',
                    name: '输入',
                    amount: 2,
                    unit: '每百万tokens',
                    range: 'Default',
                  },
                ],
              }
            : null,
        recommended: false,
        // 服务端固定把该能力的默认模型置于首位并标记已验证。
        verified: index === 0,
      })),
    })),
  };
}

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
    mockedApi.modelCatalog.mockImplementation(async (_token, capability) =>
      catalogResponse(capability, [
        {
          connectionId: '11111111-1111-4111-8111-111111111111',
          providerType: 'dashscope',
          name: '主连接',
          models: ['qwen3.5-omni-flash', 'qwen3-max'],
        },
      ]),
    );
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

    await waitFor(() =>
      expect(screen.getByText('dashscope-main · 通义千问（百炼） · 可用')).toBeTruthy(),
    );
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
    fireEvent.press(screen.getByLabelText('通义千问（百炼）'));
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
    // 知识嵌入也可以改选模型，但必须提示模型能力由用户自行确认。
    expect(screen.getByText('qwen3.7-text-embedding')).toBeTruthy();
    expect(screen.getByText(/需由你自行确认/)).toBeTruthy();

    fireEvent.press(embeddingRow);
    expect(screen.queryByTestId('capability-editor-knowledge_embedding')).toBeNull();
    fireEvent.press(screen.getByTestId('capability-row-audio_transcription'));
    expect(screen.getByTestId('capability-editor-audio_transcription')).toBeTruthy();
    expect(screen.queryByTestId('capability-editor-knowledge_embedding')).toBeNull();
    // 音频转写同样可以搜索选模型。
    expect(screen.getByLabelText('选择模型')).toBeTruthy();

    // OSS 后端没有可选模型，保持只读。
    fireEvent.press(screen.getByTestId('capability-row-audio_staging'));
    expect(screen.queryByLabelText('选择模型')).toBeNull();
  });

  it('pins the verified default model first in the picker', async () => {
    mockedApi.modelCatalog.mockImplementation(async (_token, capability) =>
      catalogResponse(capability, [
        {
          connectionId: '11111111-1111-4111-8111-111111111111',
          providerType: 'dashscope',
          name: '主连接',
          models: ['qwen3.7-text-embedding', 'text-embedding-v4'],
        },
      ]),
    );
    const screen = renderWithSession(
      <SettingsScreen onBack={jest.fn()} onOpenServiceConfiguration={jest.fn()} />,
    );
    await enterConfigurationCenter(screen);

    fireEvent.press(screen.getByTestId('capability-row-knowledge_embedding'));
    fireEvent.press(screen.getByLabelText('选择模型'));
    await waitFor(() => expect(screen.getByLabelText('text-embedding-v4')).toBeTruthy());

    // 第一行永远是已验证的默认模型，并展示向量维度供成本/兼容性判断。
    const modelRows = screen
      .getAllByRole('radio')
      .filter((row) => String(row.props.accessibilityLabel).includes('embedding'));
    expect(modelRows.map((row) => row.props.accessibilityLabel)).toEqual([
      'qwen3.7-text-embedding',
      'text-embedding-v4',
    ]);
    expect(screen.getAllByText(/已验证/).length).toBeGreaterThanOrEqual(1);
    // 置顶行按当前能力说明验证范围，避免误以为该模型对所有能力都验证过。
    expect(screen.getByText(/已按本仓库适配验证：可用于知识嵌入/)).toBeTruthy();
    expect(screen.getAllByText(/1024 维向量/).length).toBeGreaterThanOrEqual(1);
  });

  it('lazily loads the provider catalog in a sheet and saves the selected model', async () => {
    const screen = renderWithSession(
      <SettingsScreen onBack={jest.fn()} onOpenServiceConfiguration={jest.fn()} />,
    );
    await enterConfigurationCenter(screen);

    fireEvent.press(screen.getByTestId('capability-row-knowledge_chat'));
    // 展开面板不触发供应商请求：目录只在打开模型弹窗时才读取。
    expect(screen.getByText('qwen3.5-omni-flash')).toBeTruthy();
    expect(mockedApi.modelCatalog).not.toHaveBeenCalled();

    fireEvent.press(screen.getByLabelText('选择模型'));
    await waitFor(() => expect(screen.getByLabelText('qwen3-max')).toBeTruthy());
    expect(screen.getByText(/输入 2元/)).toBeTruthy();

    fireEvent.changeText(screen.getByLabelText('搜索模型名称或 ID'), 'max');
    await waitFor(() => expect(screen.queryByLabelText('qwen3.5-omni-flash')).toBeNull());
    fireEvent.press(screen.getByLabelText('qwen3-max'));
    // 选择后立即关闭弹窗并回写字段。
    await waitFor(() => expect(screen.queryByLabelText('搜索模型名称或 ID')).toBeNull());
    expect(screen.getByText('qwen3-max')).toBeTruthy();

    fireEvent.press(screen.getByText('保存能力绑定'));
    await waitFor(() =>
      expect(mockedApi.saveCapability).toHaveBeenCalledWith('admin-token', 'knowledge_chat', {
        providerConnectionId: '11111111-1111-4111-8111-111111111111',
        secondaryProviderConnectionId: null,
        model: 'qwen3-max',
        settings: { enableThinking: false },
      }),
    );
    expect(mockedApi.modelCatalog).toHaveBeenCalledWith('admin-token', 'knowledge_chat');
  });

  it('keeps the current model value and offers a retry when the catalog cannot be read', async () => {
    const overview = await mockedApi.overview('admin-token');
    mockedApi.overview.mockResolvedValue({
      ...overview,
      bindings: [
        {
          capability: 'knowledge_chat',
          providerConnectionId: overview.providers[0]!.id,
          secondaryProviderConnectionId: null,
          model: 'qwen3-max',
          settings: { enableThinking: false },
          revision: 1,
          updatedAt: '2026-09-01T00:00:00.000Z',
        },
      ],
    });
    mockedApi.overview.mockClear();
    mockedApi.modelCatalog
      .mockRejectedValueOnce(new WorkspaceRequestError('MODEL_UNAVAILABLE', '模型列表不可用。'))
      .mockResolvedValue(
        catalogResponse('knowledge_chat', [
          {
            connectionId: overview.providers[0]!.id,
            providerType: 'dashscope',
            name: '主连接',
            models: ['qwen3-max'],
          },
        ]),
      );
    const screen = renderWithSession(
      <SettingsScreen onBack={jest.fn()} onOpenServiceConfiguration={jest.fn()} />,
    );
    await enterConfigurationCenter(screen);

    fireEvent.press(screen.getByTestId('capability-row-knowledge_chat'));
    fireEvent.press(screen.getByLabelText('选择模型'));

    // 目录失败不覆盖已绑定模型，用户仍可保存原值。
    await waitFor(() => expect(screen.getByText('模型列表不可用。')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('关闭'));
    expect(screen.getByText('qwen3-max')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('选择模型'));
    await waitFor(() => expect(screen.getByText(/输入 2元/)).toBeTruthy());
    expect(mockedApi.modelCatalog).toHaveBeenCalledTimes(2);
  });

  it('surfaces a failed binding in a dialog next to the action instead of the top banner', async () => {
    mockedApi.saveCapability.mockRejectedValue(
      new WorkspaceRequestError(
        'BAD_REQUEST',
        '该模型尚未在本仓库完成适配，请选择列表中标为已验证的模型。',
      ),
    );
    const screen = renderWithSession(
      <SettingsScreen onBack={jest.fn()} onOpenServiceConfiguration={jest.fn()} />,
    );
    await enterConfigurationCenter(screen);

    fireEvent.press(screen.getByTestId('capability-row-knowledge_chat'));
    fireEvent.press(screen.getByText('保存能力绑定'));

    // 失败原因以弹窗呈现，正文里不再重复一条容易被忽略的顶部横幅。
    await waitFor(() => expect(screen.getByText('能力绑定未保存')).toBeTruthy());
    expect(
      screen.getByText('该模型尚未在本仓库完成适配，请选择列表中标为已验证的模型。'),
    ).toBeTruthy();
    expect(screen.getAllByText(/尚未在本仓库完成适配/)).toHaveLength(1);

    fireEvent.press(screen.getByText('知道了'));
    await waitFor(() => expect(screen.queryByText('能力绑定未保存')).toBeNull());
  });

  it('refreshes the model to the connection default when the provider changes', async () => {
    const overview = await mockedApi.overview('admin-token');
    mockedApi.overview.mockResolvedValue({
      ...overview,
      providers: [
        ...overview.providers,
        {
          ...overview.providers[0]!,
          id: '22222222-2222-4222-8222-222222222222',
          type: 'deepseek',
          name: '旧环境 DeepSeek',
          config: { baseUrl: 'https://api.deepseek.com' },
        },
      ],
      bindings: [
        {
          capability: 'audio_speaker_review',
          providerConnectionId: '22222222-2222-4222-8222-222222222222',
          secondaryProviderConnectionId: null,
          model: 'deepseek-v4.1-flash',
          settings: {},
          revision: 1,
          updatedAt: '2026-09-01T00:00:00.000Z',
        },
      ],
    });
    mockedApi.overview.mockClear();
    mockedApi.modelCatalog.mockImplementation(async (_token, capability) =>
      catalogResponse(capability, [
        {
          connectionId: '22222222-2222-4222-8222-222222222222',
          providerType: 'deepseek',
          name: '旧环境 DeepSeek',
          models: ['deepseek-v4.1-flash'],
        },
        {
          connectionId: '11111111-1111-4111-8111-111111111111',
          providerType: 'dashscope',
          name: '主连接',
          models: ['qwen3.5-omni-flash', 'qwen3-max'],
        },
      ]),
    );
    const screen = renderWithSession(
      <SettingsScreen onBack={jest.fn()} onOpenServiceConfiguration={jest.fn()} />,
    );
    await enterConfigurationCenter(screen);

    fireEvent.press(screen.getByTestId('capability-row-audio_speaker_review'));
    expect(screen.getByText('deepseek-v4.1-flash')).toBeTruthy();

    // 切到另一个供应商后必须刷新模型，不能留下属于上一个供应商的模型名。
    const editor = within(screen.getByTestId('capability-editor-audio_speaker_review'));
    fireEvent.press(editor.getByLabelText('主连接'));
    // 目录尚未加载时清空并要求显式选择，而不是沿用旧供应商的模型名。
    expect(screen.queryByText('deepseek-v4.1-flash')).toBeNull();
    expect(screen.getByText('尚未选择模型')).toBeTruthy();
  });

  it('keeps showing the verified default model when the provider list is unavailable', async () => {
    mockedApi.modelCatalog.mockResolvedValue(
      catalogResponse('knowledge_chat', [
        {
          connectionId: '11111111-1111-4111-8111-111111111111',
          providerType: 'dashscope',
          name: '主连接',
          models: ['qwen3.5-omni-flash'],
          catalogAvailable: false,
        },
      ]),
    );
    const screen = renderWithSession(
      <SettingsScreen onBack={jest.fn()} onOpenServiceConfiguration={jest.fn()} />,
    );
    await enterConfigurationCenter(screen);

    fireEvent.press(screen.getByTestId('capability-row-knowledge_chat'));
    fireEvent.press(screen.getByLabelText('选择模型'));

    // 列表读不出来时不显示空弹窗：给出原因、重试入口，并保留可用的默认模型。
    await waitFor(() =>
      expect(
        screen.getAllByText('暂时无法读取该供应商的模型列表，请稍后重试。').length,
      ).toBeGreaterThanOrEqual(1),
    );
    expect(screen.getByText(/仅显示该能力已验证的默认模型/)).toBeTruthy();
    expect(screen.getByLabelText('qwen3.5-omni-flash')).toBeTruthy();
    expect(screen.getByText('重新读取模型列表')).toBeTruthy();
  });

  it('does not leak an unsaved model from one capability into the next', async () => {
    const overview = await mockedApi.overview('admin-token');
    mockedApi.overview.mockResolvedValue({
      ...overview,
      providers: [
        ...overview.providers,
        {
          ...overview.providers[0]!,
          id: '22222222-2222-4222-8222-222222222222',
          type: 'deepseek',
          name: '旧环境 DeepSeek',
          config: { baseUrl: 'https://api.deepseek.com' },
        },
      ],
      // “知识问答”已有绑定：模型草稿必须回到它，而不是沿用上一个能力的未保存值。
      bindings: [
        {
          capability: 'knowledge_chat',
          providerConnectionId: '11111111-1111-4111-8111-111111111111',
          secondaryProviderConnectionId: null,
          model: 'qwen3-max',
          settings: { enableThinking: false },
          revision: 1,
          updatedAt: '2026-09-01T00:00:00.000Z',
        },
      ],
    });
    mockedApi.overview.mockClear();
    mockedApi.saveCapability.mockRejectedValue(
      new WorkspaceRequestError(
        'BAD_REQUEST',
        '该模型尚未在本仓库完成适配，请选择列表中标为已验证的模型。',
      ),
    );
    mockedApi.modelCatalog.mockImplementation(async (_token, capability) =>
      catalogResponse(capability, [
        {
          connectionId: '11111111-1111-4111-8111-111111111111',
          providerType: 'dashscope',
          name: '主连接',
          models:
            capability === 'knowledge_embedding'
              ? ['qwen3.7-text-embedding', 'text-embedding-v4']
              : ['qwen3.5-omni-flash'],
        },
        {
          connectionId: '22222222-2222-4222-8222-222222222222',
          providerType: 'deepseek',
          name: '旧环境 DeepSeek',
          models: ['deepseek-v4.1-flash'],
        },
      ]),
    );
    const screen = renderWithSession(
      <SettingsScreen onBack={jest.fn()} onOpenServiceConfiguration={jest.fn()} />,
    );
    await enterConfigurationCenter(screen);

    // 1. 在“知识嵌入”里选一个未适配的模型并保存，被服务端拒绝。
    fireEvent.press(screen.getByTestId('capability-row-knowledge_embedding'));
    fireEvent.press(screen.getByLabelText('选择模型'));
    await waitFor(() => expect(screen.getByLabelText('text-embedding-v4')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('text-embedding-v4'));
    fireEvent.press(screen.getByText('保存能力绑定'));
    await waitFor(() => expect(screen.getByText('能力绑定未保存')).toBeTruthy());
    fireEvent.press(screen.getByText('知道了'));

    // 2. 换到“知识问答”：未保存的模型名不能串到新能力。
    fireEvent.press(screen.getByTestId('capability-row-knowledge_embedding'));
    fireEvent.press(screen.getByTestId('capability-row-knowledge_chat'));
    const chatEditor = within(screen.getByTestId('capability-editor-knowledge_chat'));
    expect(chatEditor.getByText('qwen3-max')).toBeTruthy();
    expect(screen.queryByText('text-embedding-v4')).toBeNull();

    // 3. 再切到 DeepSeek：刷新为它真实提供的模型，绝不显示百炼的默认模型。
    fireEvent.press(chatEditor.getByLabelText('旧环境 DeepSeek'));
    expect(screen.queryByText('text-embedding-v4')).toBeNull();
    fireEvent.press(chatEditor.getByLabelText('选择模型'));
    await waitFor(() => expect(screen.getByLabelText('deepseek-v4.1-flash')).toBeTruthy());
    expect(screen.queryByLabelText('qwen3.5-omni-flash')).toBeNull();
    expect(screen.queryByLabelText('qwen3-max')).toBeNull();
    fireEvent.press(screen.getByLabelText('deepseek-v4.1-flash'));
    expect(chatEditor.getByText('deepseek-v4.1-flash')).toBeTruthy();
  });

  it('never shows a Qwen model inside a DeepSeek connection picker', async () => {
    const overview = await mockedApi.overview('admin-token');
    mockedApi.overview.mockResolvedValue({
      ...overview,
      providers: [
        ...overview.providers,
        {
          ...overview.providers[0]!,
          id: '22222222-2222-4222-8222-222222222222',
          type: 'deepseek',
          name: '旧环境 DeepSeek',
          config: { baseUrl: 'https://api.deepseek.com' },
        },
      ],
    });
    mockedApi.overview.mockClear();
    // 服务端按连接各自返回候选：DeepSeek 目录里既没有 qwen 默认模型，也没有 defaultModel。
    mockedApi.modelCatalog.mockImplementation(async (_token, capability) =>
      catalogResponse(capability, [
        {
          connectionId: '11111111-1111-4111-8111-111111111111',
          providerType: 'dashscope',
          name: '主连接',
          models: ['qwen3.5-omni-flash'],
        },
        {
          connectionId: '22222222-2222-4222-8222-222222222222',
          providerType: 'deepseek',
          name: '旧环境 DeepSeek',
          models: ['deepseek-v4-flash'],
          defaultModel: null,
        },
      ]),
    );
    const screen = renderWithSession(
      <SettingsScreen onBack={jest.fn()} onOpenServiceConfiguration={jest.fn()} />,
    );
    await enterConfigurationCenter(screen);

    fireEvent.press(screen.getByTestId('capability-row-knowledge_chat'));
    const chatEditor = within(screen.getByTestId('capability-editor-knowledge_chat'));
    fireEvent.press(chatEditor.getByLabelText('旧环境 DeepSeek'));
    fireEvent.press(chatEditor.getByLabelText('选择模型'));

    await waitFor(() => expect(screen.getByLabelText('deepseek-v4-flash')).toBeTruthy());
    // 本次回归的核心：DeepSeek 弹窗里不能出现任何 qwen 默认模型。
    expect(screen.queryByLabelText('qwen3.5-omni-flash')).toBeNull();
    expect(screen.queryByText(/qwen3\.5-omni-flash/)).toBeNull();
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
    // 默认全部能力都优先使用通义千问连接，因此两项 OSS 能力之外的能力都会补齐。
    expect(screen.getByLabelText('应用默认配置（7 项）')).not.toBeDisabled();
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

    fireEvent.press(screen.getByText('应用默认配置（6 项）'));
    await waitFor(() => expect(mockedApi.saveCapability).toHaveBeenCalledTimes(6));
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
    // 知识问答默认落在通义千问连接上，并携带该能力的 Thinking 设置。
    expect(mockedApi.saveCapability).toHaveBeenCalledWith('admin-token', 'knowledge_chat', {
      providerConnectionId: overview.providers[0]!.id,
      secondaryProviderConnectionId: null,
      model: 'qwen3.5-omni-flash',
      settings: { enableThinking: false },
    });
    await waitFor(() =>
      expect(
        screen.getByText(/已应用 5 项，跳过 2 项，失败 1 项。.*失败能力：情绪分析/),
      ).toBeTruthy(),
    );
    expect(mockedApi.overview).toHaveBeenCalledTimes(2);
  });
});
