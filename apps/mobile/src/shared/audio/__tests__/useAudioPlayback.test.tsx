/**
 * 页面级真实音频播放控制器测试。
 *
 * 验证整段控制、动态换源、限定片段自动暂停和播放器释放竞态防护。
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useAudioPlayback } from '../useAudioPlayback';
import { mockAudioPlayers, resetExpoAudioMock } from '@/test/ExpoAudioMock';

describe('useAudioPlayback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetExpoAudioMock();
  });

  it('drives full playback, seeking, jumping, and playback rate', async () => {
    const hook = renderHook(() => useAudioPlayback('40000000-0000-4000-8000-000000000001'));
    const player = mockAudioPlayers.at(-1)!;

    await act(async () => hook.result.current.toggleFullPlayback());
    expect(player.play).toHaveBeenCalled();

    await act(async () => hook.result.current.seekTo(30));
    await act(async () => hook.result.current.jumpBy(15));
    expect(player.seekTo).toHaveBeenNthCalledWith(1, 30);
    expect(player.seekTo).toHaveBeenNthCalledWith(2, 45);

    act(() => hook.result.current.setPlaybackRate(1.5));
    expect(player.setPlaybackRate).toHaveBeenCalledWith(1.5, 'medium');
    hook.unmount();
    expect(player.pause).not.toHaveBeenCalled();
  });

  it('does not touch the player after an in-flight segment seek outlives the screen', async () => {
    const hook = renderHook(() => useAudioPlayback('40000000-0000-4000-8000-000000000001'));
    const player = mockAudioPlayers.at(-1)!;
    let resolveSeek!: () => void;
    const pendingSeek = new Promise<void>((resolve) => {
      resolveSeek = resolve;
    });
    player.seekTo.mockImplementationOnce(() => pendingSeek);

    let playRangeTask!: Promise<void>;
    act(() => {
      playRangeTask = hook.result.current.playRange({
        key: 'segment-1',
        startSeconds: 12,
        endSeconds: 18,
      });
    });
    hook.unmount();

    await act(async () => {
      resolveSeek();
      await playRangeTask;
    });
    expect(player.play).not.toHaveBeenCalled();
    expect(player.pause).not.toHaveBeenCalled();
  });

  it('resumes a paused segment and clears it after the end boundary', async () => {
    const hook = renderHook(() => useAudioPlayback('40000000-0000-4000-8000-000000000001'));
    const player = mockAudioPlayers.at(-1)!;
    const range = { key: 'segment-1', startSeconds: 12, endSeconds: 18 };

    await act(async () => hook.result.current.playRange(range));
    expect(player.seekTo).toHaveBeenCalledWith(12);
    expect(hook.result.current.activeRangeKey).toBe('segment-1');

    await act(async () => hook.result.current.playRange(range));
    expect(player.pause).toHaveBeenCalled();
    await act(async () => hook.result.current.playRange(range));
    expect(player.seekTo).toHaveBeenCalledTimes(1);

    act(() => player.update({ currentTime: 18, playing: true }));
    await waitFor(() => expect(hook.result.current.activeRangeKey).toBeUndefined());
    expect(player.pause).toHaveBeenCalled();
  });

  it('reuses one player while switching list audio and exposes playback errors', async () => {
    const hook = renderHook(() => useAudioPlayback());
    const player = mockAudioPlayers.at(-1)!;

    act(() => hook.result.current.toggleAudio('40000000-0000-4000-8000-000000000001'));
    expect(player.replace).toHaveBeenCalledWith({
      uri: expect.stringContaining('/api/audio-files/40000000-0000-4000-8000-000000000001/content'),
    });
    act(() => player.update({ error: 'unsupported format', playing: false }));
    expect(hook.result.current.error).toBe('unsupported format');

    act(() => hook.result.current.toggleAudio('40000000-0000-4000-8000-000000000001'));
    expect(player.replace).toHaveBeenCalledTimes(2);
    expect(player.play).toHaveBeenCalledTimes(2);
  });
});
