/**
 * 一级标签页面视觉测试。
 *
 * 验证“更多”和“一键分析”页面接入统一固定页头，并保持公共卡片与创建表单结构一致。
 *
 * Responsibilities:
 * - 锁定固定页头与正文滚动容器的兄弟结构。
 * - 验证公共卡片外框和新建页标题不会重复。
 *
 * Notes:
 * - 服务状态与路由使用轻量替身，避免真实网络和导航副作用。
 */
import { act, fireEvent, render } from '@testing-library/react-native';
import { Pressable as MockPressable, StyleSheet, Text as MockText } from 'react-native';

import CreateScreen from '../create';
import MoreScreen from '../more';
import AnalysisRoute from '../../analysis';
import { colors, radii, spacing } from '@/shared/theme/tokens';
import { getAudioRuntime } from '@/shared/api/audioRuntimeApi';

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
  getAudioRuntime: jest.fn(async () => ({ mode: 'object_storage' })),
}));
jest.mock('@/shared/api/groupsApi', () => ({ getGroupSettings: jest.fn() }));

describe('Top-level tab screens', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    focusCallback = undefined;
  });

  it('keeps the More header fixed and uses four unified navigation cards', () => {
    const screen = render(<MoreScreen />);

    const header = screen.getByTestId('top-level-page-header');
    const scroll = screen.getByTestId('more-scroll');
    expect(header).toBeTruthy();
    expect(scroll.findAllByProps({ testID: 'top-level-page-header' })).toHaveLength(0);

    for (const card of [
      screen.getByLabelText('打开分析'),
      screen.getByLabelText('打开服务状态'),
      screen.getByLabelText('打开 AI 配置'),
      screen.getByLabelText('打开运行模式'),
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
    fireEvent.press(screen.getByLabelText('打开分析'));
    expect(mockPush).toHaveBeenCalledWith('/analysis');
    fireEvent.press(screen.getByLabelText('打开 AI 配置'));
    expect(mockPush).toHaveBeenCalledWith('/settings');
    fireEvent.press(screen.getByLabelText('打开服务状态'));
    expect(mockPush).toHaveBeenCalledWith('/service-status');
    fireEvent.press(screen.getByLabelText('打开运行模式'));
    expect(mockPush).toHaveBeenCalledWith('/audio-runtime');
  });

  it('opens the independent analysis route with a back action', () => {
    const screen = render(<AnalysisRoute />);

    fireEvent.press(screen.getByLabelText('返回分析工作区'));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('renders the one-click analysis title and complete pipeline guidance', async () => {
    const screen = render(<CreateScreen />);

    expect(screen.getAllByText('一键分析')).toHaveLength(1);
    expect(screen.getByRole('header', { name: '一键分析' })).toBeTruthy();
    expect(screen.getByText('上传后由服务器自动完成转写、情绪、角色和业务分析')).toBeTruthy();
    expect(await screen.findByText('1. 数据源')).toBeTruthy();
  });

  it('refreshes the one-click analysis runtime mode when the tab regains focus', async () => {
    jest.mocked(getAudioRuntime).mockResolvedValueOnce({ mode: 'object_storage' } as never);
    const screen = render(<CreateScreen />);

    expect(await screen.findByText(/本批次冻结模式：object_storage/)).toBeTruthy();
    await act(async () => focusCallback?.());
    jest.mocked(getAudioRuntime).mockResolvedValue({ mode: 'hybrid' } as never);
    await act(async () => focusCallback?.());

    expect(await screen.findByText(/本批次冻结模式：hybrid/)).toBeTruthy();
  });
});
