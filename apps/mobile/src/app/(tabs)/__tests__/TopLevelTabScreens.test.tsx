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
import { act, fireEvent, render } from '@testing-library/react-native';
import { Pressable as MockPressable, StyleSheet, Text as MockText } from 'react-native';

import CreateScreen from '../create';
import MoreScreen from '../more';
import AnalysisRoute from '../../analysis';
import AnalysisCreateRoute from '../../analysis-create';
import { colors, radii, spacing } from '@/shared/theme/tokens';
import { getAudioRuntime } from '@/shared/api/audioRuntimeApi';
import { AdminSessionProvider } from '@/shared/auth/AdminSessionProvider';
import { ServerConnectionProvider } from '@/shared/api/ServerConnectionProvider';

const mockPush = jest.fn();
const mockBack = jest.fn();
let focusCallback: (() => void) | undefined;

jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void) => {
    focusCallback = callback;
  },
  useRouter: () => ({ back: mockBack, push: mockPush }),
}));
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

describe('Top-level tab screens', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    focusCallback = undefined;
    jest.mocked(getAudioRuntime).mockResolvedValue({ ...audioRuntimeOverview });
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
    await act(async () => focusCallback?.());
    jest
      .mocked(getAudioRuntime)
      .mockResolvedValue({ ...audioRuntimeOverview, mode: 'hybrid' } as never);
    await act(async () => focusCallback?.());

    expect(await screen.findByText(/本批次冻结模式：hybrid/)).toBeTruthy();
  });
});
