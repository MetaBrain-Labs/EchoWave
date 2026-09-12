/**
 * 音频运行模式页面测试。
 *
 * 验证公开查看、不可用模式门禁和管理员口令保存流程。
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { AudioRuntimeScreen } from '../AudioRuntimeScreen';
import * as runtimeApi from '@/shared/api/audioRuntimeApi';

jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));
jest.mock('@/shared/api/audioRuntimeApi', () => ({
  getAudioRuntime: jest.fn(),
  updateAudioRuntime: jest.fn(),
}));

const overview = {
  mode: 'hybrid' as const,
  revision: 3,
  retention: { originalRetentionDays: null, intermediateRetentionHours: 24 },
  modes: [
    { mode: 'hybrid' as const, available: true, unavailableReason: null },
    { mode: 'object_storage' as const, available: true, unavailableReason: null },
    { mode: 'lightweight_local' as const, available: true, unavailableReason: null },
  ],
};

describe('AudioRuntimeScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(runtimeApi.getAudioRuntime).mockResolvedValue(overview);
    jest.mocked(runtimeApi.updateAudioRuntime).mockResolvedValue({
      ...overview,
      mode: 'lightweight_local',
      revision: 4,
    });
  });

  it('loads publicly and saves a newly selected mode with the administrator token', async () => {
    const screen = render(<AudioRuntimeScreen onBack={jest.fn()} />);
    expect(screen.getByText(/三种模式都支持/)).toBeTruthy();
    expect(await screen.findByText(/异步处理 \+ 持久本地存储 \+ OSS 中转/)).toBeTruthy();
    expect(await screen.findByText(/异步处理 \+ OSS 持久存储/)).toBeTruthy();
    expect(await screen.findByText(/异步处理 \+ 临时本地存储/)).toBeTruthy();
    const lightweight = await screen.findByRole('radio', {
      name: '轻量本地模式',
    });
    fireEvent.press(lightweight);
    fireEvent.changeText(screen.getByLabelText('管理员口令'), 'admin-token');
    fireEvent.press(screen.getByRole('button', { name: '保存运行模式' }));

    await waitFor(() =>
      expect(runtimeApi.updateAudioRuntime).toHaveBeenCalledWith('admin-token', {
        mode: 'lightweight_local',
        expectedRevision: 3,
        retention: { originalRetentionDays: null, intermediateRetentionHours: 24 },
      }),
    );
  });

  it('disables a mode whose required server capability is missing', async () => {
    jest.mocked(runtimeApi.getAudioRuntime).mockResolvedValue({
      ...overview,
      modes: overview.modes.map((mode) =>
        mode.mode === 'object_storage'
          ? { ...mode, available: false, unavailableReason: '尚未绑定权威音频对象存储。' }
          : mode,
      ),
    });
    const screen = render(<AudioRuntimeScreen onBack={jest.fn()} />);
    const objectMode = await screen.findByRole('radio', { name: '对象存储模式' });
    expect(objectMode.props.accessibilityState.disabled).toBe(true);
    expect(screen.getByText('尚未绑定权威音频对象存储。')).toBeTruthy();
  });

  it('refreshes server availability without overwriting a dirty mode draft', async () => {
    const screen = render(<AudioRuntimeScreen onBack={jest.fn()} />);
    const objectMode = await screen.findByRole('radio', { name: '对象存储模式' });
    fireEvent.press(objectMode);
    jest.mocked(runtimeApi.getAudioRuntime).mockResolvedValue({ ...overview, revision: 4 });

    await act(async () => {
      screen.getByTestId('audio-runtime-scroll').props.refreshControl.props.onRefresh();
    });

    expect(
      screen.getByRole('radio', { name: '对象存储模式' }).props.accessibilityState.checked,
    ).toBe(true);
    expect(runtimeApi.getAudioRuntime).toHaveBeenCalledTimes(2);
  });
});
