/**
 * 手机录音页面选择交互测试。
 *
 * 验证独立录音入口会自动选择首个有效目标，并为用户后续选择呈现明确的视觉状态。
 *
 * Responsibilities:
 * - 锁定数据源与分组选中态的无障碍和颜色反馈。
 *
 * Notes:
 * - 原生录音生命周期由 RecordingProvider 的独立测试覆盖。
 */
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { RecordingScreen } from '../RecordingScreen';
import { colors } from '@/shared/theme/tokens';

const mockRecording = {
  activeId: undefined,
  busy: false,
  drafts: [],
  durationMs: 0,
  error: undefined,
  isRecording: false,
  pause: jest.fn(),
  remove: jest.fn(),
  resume: jest.fn(),
  start: jest.fn(),
  stop: jest.fn(),
  update: jest.fn(),
};

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
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
    formatDateTime: (value: string) => value,
    language: 'zh-CN',
    t: (key: string) =>
      ({
        'common.back': '返回',
        'recording.backgroundRecording': '后台录音说明',
        'recording.group': '分析分组（分析前必选）',
        'recording.source': '所属数据源（暂存前必选）',
        'recording.start': '开始录音',
        'recording.title': '手机录音',
      })[key] ?? key,
  }),
}));

describe('RecordingScreen', () => {
  it('shows the current data source and group as selected after switching', async () => {
    const screen = render(<RecordingScreen onBack={jest.fn()} />);

    const firstSource = await screen.findByRole('radio', { name: '数据源 A' });
    await waitFor(() => expect(firstSource.props.accessibilityState).toEqual({ checked: true }));
    expect(StyleSheet.flatten(firstSource.props.style)).toEqual(
      expect.objectContaining({ backgroundColor: colors.ink, borderColor: colors.ink }),
    );

    fireEvent.press(screen.getByRole('radio', { name: '数据源 B' }));
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: '数据源 B' }).props.accessibilityState).toEqual({
        checked: true,
      }),
    );
    const selectedGroup = await screen.findByRole('radio', { name: '分组 B' });
    expect(selectedGroup.props.accessibilityState).toEqual({ checked: true });
    expect(StyleSheet.flatten(selectedGroup.props.style)).toEqual(
      expect.objectContaining({ backgroundColor: colors.ink, borderColor: colors.ink }),
    );
  });
});
