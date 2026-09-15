/**
 * 手机录音页面信息架构与交互测试。
 *
 * 验证数据源菜单、分析分组、主录音控制和最近录音低频操作保持移动端层级与原有能力。
 *
 * Responsibilities:
 * - 锁定首屏核心操作、选中态和可扩展数据源入口。
 * - 验证录音卡片只外露试听与分析，其他操作进入菜单。
 *
 * Notes:
 * - 原生录音生命周期由 RecordingProvider 的独立测试覆盖。
 */
import type { RecordingDraft } from '@echowave/contracts';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { RecordingScreen } from '../RecordingScreen';
import { colors, radii } from '@/shared/theme/tokens';

const mockRecording: {
  activeId?: string;
  busy: boolean;
  drafts: RecordingDraft[];
  durationMs: number;
  error?: string;
  isRecording: boolean;
  pause: jest.Mock;
  remove: jest.Mock;
  resume: jest.Mock;
  start: jest.Mock;
  stop: jest.Mock;
  update: jest.Mock;
} = {
  activeId: undefined,
  busy: false,
  drafts: [],
  durationMs: 0,
  error: undefined,
  isRecording: false,
  pause: jest.fn(async () => undefined),
  remove: jest.fn(async () => undefined),
  resume: jest.fn(async () => undefined),
  start: jest.fn(async () => undefined),
  stop: jest.fn(async () => undefined),
  update: jest.fn(async () => undefined),
};

const translations: Record<string, string> = {
  'analysisBatch.noGroups': '当前数据源尚未关联分组。',
  'common.back': '返回',
  'common.cancel': '取消',
  'recording.analyze': '分析',
  'recording.backgroundDetailsTitle': '后台录音说明',
  'recording.backgroundRecording': '完整后台录音说明',
  'recording.backgroundSummary': '支持后台录音，来电中断时自动保留录音',
  'recording.changeSource': '修改',
  'recording.chooseSource': '选择数据源',
  'recording.context': '分析上下文',
  'recording.currentSelection': '当前选择',
  'recording.deleteOriginal': '删除本地录音',
  'recording.export': '导出原件',
  'recording.groupDescription': '选择本次录音所属的分析分组',
  'recording.groupLabel': '分析分组',
  'recording.groupRequired': '必选',
  'recording.learnMore': '了解更多',
  'recording.listen': '试听',
  'recording.localStatus': '仅当前手机可见',
  'recording.minutes': '%{minutes} 分 %{seconds} 秒',
  'recording.moreActions': '更多录音操作',
  'recording.name': '录音名称',
  'recording.noRecent': '完成录音后，手机原件会显示在这里。',
  'recording.noSource': '尚未选择数据源',
  'recording.openSettings': '打开录音设置',
  'recording.recent': '最近录音',
  'recording.rename': '重命名',
  'recording.seconds': '%{count} 秒',
  'recording.sourceLabel': '数据源',
  'recording.start': '开始录音',
  'recording.startHint': '点击开始本次录音',
  'recording.store': '保存到数据源',
  'recording.title': '手机录音',
  'recording.today': '今天',
  'recording.yesterday': '昨天',
};
const mockT = (key: string, options: Record<string, unknown> = {}) =>
  Object.entries(options).reduce(
    (value, [name, replacement]) => value.replace(`%{${name}}`, String(replacement)),
    translations[key] ?? key,
  );

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('@/shared/api/apiUrl', () => ({ getApiUrl: () => 'https://example.com' }));
jest.mock('@/shared/audio/useAudioPlayback', () => ({
  useAudioPlayback: () => ({
    error: undefined,
    isPlaying: false,
    toggleFullPlayback: jest.fn(async () => undefined),
  }),
}));
jest.mock('@/shared/recording/recordingOperations', () => ({
  analyzeRecording: jest.fn(),
  storeRecording: jest.fn(),
}));
jest.mock('@/shared/recording/RecordingProvider', () => ({
  useRecording: () => mockRecording,
}));
jest.mock('@/shared/api/audioRuntimeApi', () => ({
  getAudioRuntime: jest.fn(async () => ({ mode: 'hybrid' })),
}));
jest.mock('@/shared/api/dataSourcesApi', () => ({
  listDataSources: jest.fn(async () => ({
    items: [
      { id: 'source-a', name: '数据源 A' },
      { id: 'source-b', name: '数据源 B' },
    ],
  })),
  listDataSourceGroups: jest.fn(async (sourceId: string) => ({
    items:
      sourceId === 'source-a'
        ? [{ id: 'group-a', name: '分组 A' }]
        : [{ id: 'group-b', name: '分组 B' }],
  })),
}));
jest.mock('@/shared/i18n/LanguageProvider', () => ({
  useAppLanguage: () => ({
    language: 'zh-CN',
    t: mockT,
  }),
}));

function renderRecordingScreen(onOpenSettings = jest.fn()) {
  const screen = render(<RecordingScreen onBack={jest.fn()} onOpenSettings={onOpenSettings} />);
  return {
    onOpenSettings,
    screen,
  };
}

describe('RecordingScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRecording.activeId = undefined;
    mockRecording.busy = false;
    mockRecording.drafts = [];
    mockRecording.durationMs = 0;
    mockRecording.error = undefined;
    mockRecording.isRecording = false;
  });

  it('keeps the source compact, switches it in a sheet and shows selected group chips', async () => {
    const { screen } = renderRecordingScreen();

    expect(await screen.findByText('数据源 A')).toBeTruthy();
    expect(screen.queryByRole('radio', { name: '数据源 B' })).toBeNull();
    fireEvent.press(screen.getByLabelText('选择数据源'));
    fireEvent.press(screen.getByRole('button', { name: /数据源 B/ }));

    await waitFor(() => expect(screen.getAllByText('数据源 B').length).toBeGreaterThan(0));
    const selectedGroup = await screen.findByRole('radio', { name: '分组 B' });
    expect(selectedGroup.props.accessibilityState).toEqual({ checked: true });
    expect(StyleSheet.flatten(selectedGroup.props.style)).toEqual(
      expect.objectContaining({ backgroundColor: colors.ink }),
    );
  });

  it('makes recording the primary visual action and keeps the settings icon neutral', async () => {
    const { screen, onOpenSettings } = renderRecordingScreen();

    await screen.findByText('分组 A');
    const start = await screen.findByLabelText('开始录音');
    expect(StyleSheet.flatten(start.props.style)).toEqual(
      expect.objectContaining({
        backgroundColor: colors.black,
        borderRadius: radii.default,
        minHeight: 164,
      }),
    );
    expect(screen.getByRole('header', { name: '最近录音' })).toBeTruthy();

    const settings = screen.getByLabelText('打开录音设置');
    expect(StyleSheet.flatten(settings.props.style)).toEqual(
      expect.objectContaining({ height: 44, width: 44 }),
    );
    expect(StyleSheet.flatten(settings.props.style).backgroundColor).toBeUndefined();
    expect(StyleSheet.flatten(screen.getByTestId('icon-settings-outline').props.style)).toEqual(
      expect.objectContaining({ height: 22, width: 22 }),
    );
    fireEvent.press(settings);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('moves export, storage and destructive actions into the recording overflow menu', async () => {
    mockRecording.drafts = [
      {
        version: 1,
        id: '10000000-0000-4000-8000-000000000001',
        title: '用户访谈录音',
        createdAt: new Date().toISOString(),
        path: 'recordings/interview.m4a',
        durationMs: 6_000,
        sizeBytes: 100_000,
        serverUrl: 'https://example.com',
        dataSourceId: 'source-a',
        interrupted: false,
        state: 'local',
      },
    ];
    const { screen } = renderRecordingScreen();

    await screen.findByText('分组 A');
    expect(await screen.findByText('用户访谈录音')).toBeTruthy();
    expect(screen.getByText(/今天 .* · 6 秒 · 0\.1 MB/)).toBeTruthy();
    expect(screen.getByText('试听')).toBeTruthy();
    expect(screen.getByText('分析')).toBeTruthy();
    expect(screen.queryByText('导出原件')).toBeNull();
    expect(screen.queryByText('保存到数据源')).toBeNull();
    expect(screen.queryByText('删除本地录音')).toBeNull();

    fireEvent.press(screen.getByLabelText('更多录音操作'));
    expect(screen.getByText('导出原件')).toBeTruthy();
    expect(screen.getByText('保存到数据源')).toBeTruthy();
    expect(screen.getByText('删除本地录音')).toBeTruthy();
  });

  it('shows a compact timer and preserves pause plus finish controls while recording', async () => {
    mockRecording.activeId = 'active-recording';
    mockRecording.durationMs = 6_000;
    mockRecording.isRecording = true;
    const { screen } = renderRecordingScreen();

    await screen.findByText('分组 A');
    expect(await screen.findByText('00:06')).toBeTruthy();
    expect(screen.getByText('recording.capturing')).toBeTruthy();
    expect(screen.getByText('recording.pause')).toBeTruthy();
    expect(screen.getByText('recording.finish')).toBeTruthy();
  });
});
