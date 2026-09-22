/**
 * 一级标签页面视觉测试。
 *
 * 验证“更多”、新建入口与一键分析页面接入统一固定页头，并保持卡片和表单结构一致。
 *
 * Responsibilities:
 * - 锁定固定页头与正文滚动容器的兄弟结构。
 * - 验证公共卡片外框、“更多”页服务状态摘要和新建页标题不会重复。
 *
 * Notes:
 * - 服务状态与路由使用轻量替身，避免真实网络和导航副作用。
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Pressable as MockPressable, StyleSheet, Text as MockText } from 'react-native';
import { useEffect } from 'react';

import CreateScreen from '../create';
import MoreScreen from '../more';
import AnalysisRoute from '../../analysis';
import AnalysisCreateRoute from '../../analysis-create';
import { colors, radii, spacing } from '@/shared/theme/tokens';
import { getAudioRuntime } from '@/shared/api/audioRuntimeApi';
import {
  getKnowledgeRetrievalSettings,
  updateKnowledgeRetrievalSettings,
} from '@/shared/api/knowledgeRetrievalSettingsApi';
import { settingsApi } from '@/shared/api/settingsApi';
import { AdminSessionProvider, useAdminSession } from '@/shared/auth/AdminSessionProvider';
import { ServerConnectionProvider } from '@/shared/api/ServerConnectionProvider';

const mockPush = jest.fn();
const mockBack = jest.fn();
let mockFocusCallbacks: (() => void)[] = [];

jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void) => {
    mockFocusCallbacks.push(callback);
  },
  useRouter: () => ({ back: mockBack, push: mockPush }),
}));
jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual('react-native-safe-area-context');
  return {
    ...actual,
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  };
});
jest.mock('@/features/analysis-runs/AnalysisRunsScreen', () => ({
  AnalysisRunsScreen: ({ onBack }: { onBack?: () => void }) => (
    <MockPressable accessibilityLabel="返回分析工作区" onPress={onBack}>
      <MockText>分析工作区替身</MockText>
    </MockPressable>
  ),
}));
jest.mock('@/shared/api/audioAutomationApi', () => ({
  listAudioAnalysisBatches: jest.fn(async () => ({ items: [] })),
  createExistingAudioAnalysisBatch: jest.fn(),
  createUploadAnalysisBatch: jest.fn(),
}));
jest.mock('@/shared/api/dataSourcesApi', () => ({
  listDataSources: jest.fn(async () => ({ items: [] })),
  listDataSourceGroups: jest.fn(async () => ({ items: [] })),
  listDataSourceAudioFiles: jest.fn(async () => ({ items: [] })),
}));
jest.mock('@/shared/api/audioRuntimeApi', () => ({
  getAudioRuntime: jest.fn(),
}));
jest.mock('@/shared/api/knowledgeRetrievalSettingsApi', () => ({
  getKnowledgeRetrievalSettings: jest.fn(),
  updateKnowledgeRetrievalSettings: jest.fn(),
}));
jest.mock('@/shared/api/settingsApi', () => ({
  settingsApi: {
    dashScopeWorkspaceStatus: jest.fn(),
    migrateDashScopeWorkspace: jest.fn(),
  },
}));
jest.mock('@/shared/api/groupsApi', () => ({ getGroupSettings: jest.fn() }));
jest.mock('@/shared/api/serverHealth', () => ({
  fetchServerHealth: jest.fn(async () => ({ version: '0.3.0' })),
}));
jest.mock('@/shared/onboarding/StarterTourContext', () => ({
  useStarterTour: () => ({ replay: jest.fn() }),
  useStarterTourTarget: () => undefined,
}));

/** 公开运行模式概览替身，供“更多”摘要卡与一键分析页共同使用。 */
const audioRuntimeOverview = {
  mode: 'object_storage' as const,
  revision: 1,
  retention: { originalRetentionDays: null, intermediateRetentionHours: 24 },
  modes: [
    { mode: 'hybrid' as const, available: true, unavailableReason: null },
    { mode: 'object_storage' as const, available: true, unavailableReason: null },
    { mode: 'lightweight_local' as const, available: true, unavailableReason: null },
  ],
};

/** 为需要管理员身份的交互用例注入仅存于内存的测试会话。 */
function AdminSessionSeeder({ token }: { token: string }) {
  const { setSession } = useAdminSession();
  useEffect(() => setSession(token), [setSession, token]);
  return null;
}

describe('Top-level tab screens', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFocusCallbacks = [];
    jest.mocked(getAudioRuntime).mockResolvedValue({ ...audioRuntimeOverview });
    jest.mocked(getKnowledgeRetrievalSettings).mockResolvedValue({
      rerankEnabled: true,
      rerankerModel: 'qwen3.7-text-rerank',
      rerankerConfigured: true,
      revision: 1,
    });
    jest.mocked(settingsApi.dashScopeWorkspaceStatus).mockResolvedValue({
      status: 'dedicated',
      migrationRequired: false,
      totalConnectionCount: 1,
      legacyConnectionCount: 0,
    });
  });

  it('migrates legacy DashScope connections with the default Beijing workspace domain', async () => {
    jest.mocked(settingsApi.dashScopeWorkspaceStatus).mockResolvedValue({
      status: 'legacy',
      migrationRequired: true,
      totalConnectionCount: 2,
      legacyConnectionCount: 2,
    });
    jest.mocked(settingsApi.migrateDashScopeWorkspace).mockResolvedValue({
      workspace: {
        status: 'dedicated',
        migrationRequired: false,
        totalConnectionCount: 2,
        legacyConnectionCount: 0,
      },
      updatedConnectionCount: 2,
      rerankBindingCreated: true,
    });
    const screen = render(
      <ServerConnectionProvider>
        <AdminSessionProvider serverRevision={0}>
          <AdminSessionSeeder token="admin" />
          <MoreScreen />
        </AdminSessionProvider>
      </ServerConnectionProvider>,
    );

    await act(async () => mockFocusCallbacks.forEach((callback) => callback()));
    fireEvent.press(await screen.findByLabelText('迁移到业务空间专属域名'));
    expect(screen.getByText('华北 2（北京）')).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText('Workspace ID'), 'ws-echowave');
    expect(screen.getByText('https://ws-echowave.cn-beijing.maas.aliyuncs.com')).toBeTruthy();
    fireEvent.press(screen.getByText('验证并迁移'));

    await waitFor(() =>
      expect(settingsApi.migrateDashScopeWorkspace).toHaveBeenCalledWith('admin', {
        workspaceId: 'ws-echowave',
        region: 'cn-beijing',
      }),
    );
    await waitFor(() => expect(screen.queryByText('百炼域名待升级')).toBeNull());
  });

  it('rejects a full API Host locally instead of posting an invalid parameter', async () => {
    jest.mocked(settingsApi.dashScopeWorkspaceStatus).mockResolvedValue({
      status: 'legacy',
      migrationRequired: true,
      totalConnectionCount: 1,
      legacyConnectionCount: 1,
    });
    const screen = render(
      <ServerConnectionProvider>
        <AdminSessionProvider serverRevision={0}>
          <AdminSessionSeeder token="admin" />
          <MoreScreen />
        </AdminSessionProvider>
      </ServerConnectionProvider>,
    );

    await act(async () => mockFocusCallbacks.forEach((callback) => callback()));
    fireEvent.press(await screen.findByLabelText('迁移到业务空间专属域名'));
    fireEvent.changeText(
      screen.getByLabelText('Workspace ID'),
      'ws-echowave.cn-beijing.maas.aliyuncs.com',
    );
    fireEvent.press(screen.getByText('验证并迁移'));

    // 完整域名不是单段 DNS 标签：本地就给出具体原因，不能退化成服务端的通用参数错误。
    expect(
      screen.getByText(
        '业务空间域名前缀无效：只填 API Host 中第一个点之前的部分，例如 ws-xxxxxxxx。',
      ),
    ).toBeTruthy();
    expect(settingsApi.migrateDashScopeWorkspace).not.toHaveBeenCalled();
  });

  it('loads the authoritative rerank switch and routes unverified writes to service config', async () => {
    const screen = render(
      <ServerConnectionProvider>
        <AdminSessionProvider serverRevision={0}>
          <MoreScreen />
        </AdminSessionProvider>
      </ServerConnectionProvider>,
    );

    await act(async () => mockFocusCallbacks.forEach((callback) => callback()));
    const toggle = await screen.findByLabelText('切换 RAG 智能重排');
    expect(toggle.props.value).toBe(true);
    fireEvent(toggle, 'valueChange', false);
    expect(mockPush).toHaveBeenCalledWith('/service-configuration');
    expect(screen.getByText('请先前往服务配置验证管理员口令。')).toBeTruthy();
  });

  it('persists rerank changes with the server revision when an administrator is verified', async () => {
    jest.mocked(updateKnowledgeRetrievalSettings).mockResolvedValue({
      rerankEnabled: false,
      rerankerModel: 'qwen3.7-text-rerank',
      rerankerConfigured: false,
      revision: 2,
    });
    const screen = render(
      <ServerConnectionProvider>
        <AdminSessionProvider serverRevision={0}>
          <AdminSessionSeeder token="admin" />
          <MoreScreen />
        </AdminSessionProvider>
      </ServerConnectionProvider>,
    );

    await act(async () => mockFocusCallbacks.forEach((callback) => callback()));
    fireEvent(screen.getByLabelText('切换 RAG 智能重排'), 'valueChange', false);

    await waitFor(() =>
      expect(updateKnowledgeRetrievalSettings).toHaveBeenCalledWith('admin', {
        rerankEnabled: false,
        expectedRevision: 1,
      }),
    );
    await waitFor(() => expect(screen.getByLabelText('切换 RAG 智能重排').props.value).toBe(false));
  });

  it('keeps the More header fixed and exposes the service summary plus every entry', async () => {
    const screen = render(
      <ServerConnectionProvider>
        <AdminSessionProvider serverRevision={0}>
          <MoreScreen />
        </AdminSessionProvider>
      </ServerConnectionProvider>,
    );

    const header = screen.getByTestId('top-level-page-header');
    const scroll = screen.getByTestId('more-scroll');
    expect(header).toBeTruthy();
    expect(scroll.findAllByProps({ testID: 'top-level-page-header' })).toHaveLength(0);

    for (const card of [
      screen.getByLabelText('打开知识收集'),
      screen.getByLabelText('打开分析'),
      screen.getByLabelText('打开服务状态'),
      screen.getByLabelText('打开通用设置'),
      screen.getByLabelText('打开服务配置'),
      screen.getByLabelText('打开新手引导中心'),
    ]) {
      expect(StyleSheet.flatten(card.props.style)).toEqual(
        expect.objectContaining({
          backgroundColor: colors.card,
          borderColor: colors.divider,
          borderRadius: radii.default,
          // 固定最小高度 + 单行说明，保证同一列表内所有入口卡高度一致。
          minHeight: 88,
          padding: spacing.md,
        }),
      );
    }

    expect(screen.queryByLabelText('打开数据源与音频文件')).toBeNull();
    // AI 配置与运行模式已并入“服务配置”，更多页不再保留重复入口。
    expect(screen.queryByLabelText('打开 AI 配置')).toBeNull();
    expect(screen.queryByLabelText('打开运行模式')).toBeNull();
    fireEvent.press(screen.getByLabelText('打开知识收集'));
    expect(mockPush).toHaveBeenCalledWith('/collection');
    fireEvent.press(screen.getByLabelText('打开分析'));
    expect(mockPush).toHaveBeenCalledWith('/analysis');
    fireEvent.press(screen.getByLabelText('打开服务状态'));
    expect(mockPush).toHaveBeenCalledWith('/service-status');
    fireEvent.press(screen.getByLabelText('打开通用设置'));
    expect(mockPush).toHaveBeenCalledWith('/general-settings');
    fireEvent.press(screen.getByLabelText('打开服务配置'));
    expect(mockPush).toHaveBeenCalledWith('/service-configuration');
    expect(screen.getByText('新手引导')).toBeTruthy();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.queryByLabelText('简体中文')).toBeNull();

    // 服务状态摘要：首屏直接显示运行模式，不需点进详情页。
    expect(await screen.findByText(/对象存储模式/)).toBeTruthy();
    fireEvent.press(screen.getByLabelText('打开服务状态详情'));
    expect(mockPush).toHaveBeenCalledWith('/service-status');

    fireEvent.press(screen.getByLabelText('打开新手引导中心'));
    expect(mockPush).toHaveBeenCalledWith('/guides');
  });

  it('opens the independent analysis route with a back action', () => {
    const screen = render(<AnalysisRoute />);

    fireEvent.press(screen.getByLabelText('返回分析工作区'));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('renders two independent create cards and opens their routes', () => {
    const screen = render(<CreateScreen />);

    expect(screen.getByRole('header', { name: '新建' })).toBeTruthy();
    // 该页尚无引导，顶部栏按钮改为展开功能说明卡片。
    expect(screen.queryByTestId('guide-hint-guideHint.createHub')).toBeNull();
    fireEvent.press(screen.getByLabelText('查看本功能能做什么'));
    expect(screen.getByTestId('guide-hint-guideHint.createHub')).toBeTruthy();
    expect(screen.getByText(/一键分析：从数据源挑选已有音频/)).toBeTruthy();
    fireEvent.press(screen.getByLabelText('查看本功能能做什么'));
    expect(screen.queryByTestId('guide-hint-guideHint.createHub')).toBeNull();

    for (const card of [
      screen.getByLabelText('打开一键分析'),
      screen.getByLabelText('打开手机录音'),
    ]) {
      expect(StyleSheet.flatten(card.props.style)).toEqual(
        expect.objectContaining({
          backgroundColor: colors.card,
          borderRadius: radii.default,
          minHeight: 112,
          padding: spacing.md,
        }),
      );
    }
    expect(
      StyleSheet.flatten(screen.getByTestId('create-hub-icon-analysis').props.style)
        .backgroundColor,
    ).toBeUndefined();
    expect(
      StyleSheet.flatten(screen.getByTestId('create-hub-icon-recording').props.style)
        .backgroundColor,
    ).toBeUndefined();
    fireEvent.press(screen.getByLabelText('打开一键分析'));
    expect(mockPush).toHaveBeenCalledWith('/analysis-create');
    fireEvent.press(screen.getByLabelText('打开手机录音'));
    expect(mockPush).toHaveBeenCalledWith('/recording');
  });

  it('renders the independent one-click analysis form with a back action', async () => {
    const screen = render(<AnalysisCreateRoute />);
    expect(screen.getByRole('header', { name: '一键分析' })).toBeTruthy();
    expect(screen.getByText('上传后由服务器自动完成转写、情绪、角色和业务分析')).toBeTruthy();
    expect(await screen.findByText('分析对象')).toBeTruthy();
    expect(screen.queryByRole('tab', { name: '手机录音' })).toBeNull();
    expect(StyleSheet.flatten(screen.getByRole('tab', { name: '新上传' }).props.style)).toEqual(
      expect.objectContaining({ borderRadius: radii.round }),
    );
    fireEvent.press(screen.getByLabelText('返回'));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('refreshes the one-click analysis runtime mode when the tab regains focus', async () => {
    jest.mocked(getAudioRuntime).mockResolvedValueOnce({ ...audioRuntimeOverview });
    const screen = render(<AnalysisCreateRoute />);

    fireEvent.press(await screen.findByRole('button', { name: '更多设置' }));
    expect(await screen.findByText(/本批次冻结模式：object_storage/)).toBeTruthy();
    await act(async () => mockFocusCallbacks.forEach((callback) => callback()));
    jest
      .mocked(getAudioRuntime)
      .mockResolvedValue({ ...audioRuntimeOverview, mode: 'hybrid' } as never);
    await act(async () => mockFocusCallbacks.forEach((callback) => callback()));

    expect(await screen.findByText(/本批次冻结模式：hybrid/)).toBeTruthy();
  });
});
