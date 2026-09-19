/**
 * 音频运行模式页面测试。
 *
 * 验证共享会话门禁、不可用模式拦截和管理员保存流程。
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Text } from 'react-native';

import { AdminSessionProvider, useAdminSession } from '@/shared/auth/AdminSessionProvider';
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

/** 通过真实上下文写入共享会话，模拟用户已在“服务配置”完成校验。 */
function SeedSession({ token }: { token: string }) {
  const { setSession } = useAdminSession();
  return (
    <Text accessibilityRole="button" onPress={() => setSession(token)}>
      建立共享会话
    </Text>
  );
}

/** 渲染运行模式页；authorized 为 false 时保持未校验状态。 */
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

const runtimeScreen = (
  <AudioRuntimeScreen onBack={jest.fn()} onOpenServiceConfiguration={jest.fn()} />
);

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

  it('shows the shared-session gate instead of a second token input when unverified', () => {
    const onOpenServiceConfiguration = jest.fn();
    const screen = renderWithSession(
      <AudioRuntimeScreen
        onBack={jest.fn()}
        onOpenServiceConfiguration={onOpenServiceConfiguration}
      />,
      { authorized: false },
    );

    expect(screen.getByText('需要管理员校验')).toBeTruthy();
    // 未校验时既不加载公开模式，也不出现本页独立口令输入。
    expect(screen.queryByLabelText('管理员口令')).toBeNull();
    expect(runtimeApi.getAudioRuntime).not.toHaveBeenCalled();
    fireEvent.press(screen.getByLabelText('前往服务配置校验'));
    expect(onOpenServiceConfiguration).toHaveBeenCalledTimes(1);
  });

  it('loads publicly and saves a newly selected mode with the shared session token', async () => {
    const screen = renderWithSession(runtimeScreen);
    expect(screen.getByText(/混合存储模式/)).toBeTruthy();
    expect(await screen.findByText(/异步处理 \+ 持久本地存储 \+ OSS 中转/)).toBeTruthy();
    expect(await screen.findByText(/异步处理 \+ OSS 持久存储/)).toBeTruthy();
    expect(await screen.findByText(/异步处理 \+ 临时本地存储/)).toBeTruthy();
    const lightweight = await screen.findByRole('radio', {
      name: '轻量本地模式',
    });
    fireEvent.press(lightweight);
    fireEvent.press(screen.getByRole('button', { name: '保存运行模式' }));

    await waitFor(() =>
      expect(runtimeApi.updateAudioRuntime).toHaveBeenCalledWith('admin-token', {
        mode: 'lightweight_local',
        expectedRevision: 3,
        retention: { originalRetentionDays: null, intermediateRetentionHours: 24 },
      }),
    );
    // 已校验时不再显示任何独立口令输入。
    expect(screen.queryByLabelText('管理员口令')).toBeNull();
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
    const screen = renderWithSession(runtimeScreen);
    const objectMode = await screen.findByRole('radio', { name: '对象存储模式' });
    expect(objectMode.props.accessibilityState.disabled).toBe(true);
    expect(screen.getByText('尚未绑定权威音频对象存储。')).toBeTruthy();
  });

  it('refreshes server availability without overwriting a dirty mode draft', async () => {
    const screen = renderWithSession(runtimeScreen);
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
