/**
 * 页面级真实音频播放控制器。
 *
 * 封装 expo-audio 的生命周期、加载状态、全局跳转和限定时间片段播放，供分析详情与音频列表复用。
 *
 * Responsibilities:
 * - 统一前台音频会话、播放进度和错误状态。
 * - 保证片段播放在结束时间自动暂停。
 * - 切换音频时复用单个页面级播放器。
 *
 * Notes:
 * - 不启用后台播放或锁屏媒体控制；页面卸载时立即暂停并由 hook 自动释放实例。
 */
import {
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  type AudioSource,
} from 'expo-audio';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { audioPlaybackUrl } from '@/shared/api/apiUrl';

type PlaybackRange = {
  endSeconds: number;
  key: string;
  startSeconds: number;
};

let audioModeTask: Promise<void> | undefined;

function configureAudioMode(): Promise<void> {
  audioModeTask ??= setAudioModeAsync({
    allowsRecording: false,
    interruptionMode: 'doNotMix',
    playsInSilentMode: true,
    shouldPlayInBackground: false,
    shouldRouteThroughEarpiece: false,
  }).catch((error: unknown) => {
    audioModeTask = undefined;
    throw error;
  });
  return audioModeTask;
}

function sourceFor(audioFileId: string | undefined): AudioSource {
  return audioFileId ? { uri: audioPlaybackUrl(audioFileId) } : null;
}

/** 创建一个离开页面即停止的音频播放控制器。 */
export function useAudioPlayback(initialAudioFileId?: string) {
  const player = useAudioPlayer(sourceFor(initialAudioFileId), {
    crossOrigin: 'anonymous',
    updateInterval: 100,
  });
  const status = useAudioPlayerStatus(player);
  const [activeAudioFileId, setActiveAudioFileId] = useState(initialAudioFileId);
  const [activeRange, setActiveRange] = useState<PlaybackRange>();
  const [operationError, setOperationError] = useState<string>();
  const mountedRef = useRef(true);
  const sourceIdRef = useRef(initialAudioFileId);

  useEffect(() => {
    mountedRef.current = true;
    void configureAudioMode().catch(() => {
      if (!mountedRef.current) return;
      setOperationError('无法初始化设备音频播放，请稍后重试。');
    });
    return () => {
      // useAudioPlayer 会在同一次卸载中自动停止并释放原生 SharedObject，不能再次调用 pause。
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (initialAudioFileId === sourceIdRef.current) return;
    sourceIdRef.current = initialAudioFileId;
    setActiveAudioFileId(initialAudioFileId);
    setActiveRange(undefined);
    setOperationError(undefined);
    player.pause();
    player.replace(sourceFor(initialAudioFileId));
  }, [initialAudioFileId, player]);

  const activeRangeEnded = Boolean(
    activeRange && (status.didJustFinish || status.currentTime + 0.02 >= activeRange.endSeconds),
  );

  useEffect(() => {
    if (!activeRange || !activeRangeEnded || !status.playing) return;
    player.pause();
    void player.seekTo(activeRange.endSeconds).catch(() => undefined);
  }, [activeRange, activeRangeEnded, player, status.playing]);

  const runSeek = useCallback(
    async (seconds: number) => {
      try {
        setOperationError(undefined);
        await player.seekTo(Math.max(0, seconds));
      } catch {
        setOperationError('无法跳转到指定播放位置，请重试。');
      }
    },
    [player],
  );

  const toggleFullPlayback = useCallback(async () => {
    setActiveRange(undefined);
    setOperationError(undefined);
    if (status.playing) {
      player.pause();
      return;
    }
    if (status.didJustFinish) await runSeek(0);
    player.play();
  }, [player, runSeek, status.didJustFinish, status.playing]);

  const seekTo = useCallback(
    async (seconds: number) => {
      setActiveRange(undefined);
      await runSeek(seconds);
    },
    [runSeek],
  );

  const jumpBy = useCallback(
    async (seconds: number) => {
      setActiveRange(undefined);
      const duration = status.duration > 0 ? status.duration : Number.POSITIVE_INFINITY;
      await runSeek(Math.min(duration, Math.max(0, status.currentTime + seconds)));
    },
    [runSeek, status.currentTime, status.duration],
  );

  const playRange = useCallback(
    async (range: PlaybackRange) => {
      setOperationError(undefined);
      if (activeRange?.key === range.key && status.playing && !activeRangeEnded) {
        player.pause();
        return;
      }
      try {
        if (
          activeRange?.key !== range.key ||
          status.currentTime < range.startSeconds ||
          status.currentTime >= range.endSeconds
        ) {
          await player.seekTo(range.startSeconds);
        }
        // 页面可能在原生 seek 完成前离开，此时播放器已经由 expo-audio 自动释放。
        if (!mountedRef.current) return;
        setActiveRange(range);
        player.play();
      } catch {
        if (!mountedRef.current) return;
        setOperationError('无法播放该正文片段，请重试。');
      }
    },
    [activeRange, activeRangeEnded, player, status.currentTime, status.playing],
  );

  const toggleAudio = useCallback(
    (audioFileId: string) => {
      setOperationError(undefined);
      setActiveRange(undefined);
      if (audioFileId === activeAudioFileId) {
        if (status.error) {
          player.pause();
          player.replace(sourceFor(audioFileId));
          player.play();
        } else if (status.playing) {
          player.pause();
        } else {
          if (status.didJustFinish) void player.seekTo(0).catch(() => undefined);
          player.play();
        }
        return;
      }
      player.pause();
      player.replace(sourceFor(audioFileId));
      sourceIdRef.current = audioFileId;
      setActiveAudioFileId(audioFileId);
      player.play();
    },
    [activeAudioFileId, player, status.didJustFinish, status.error, status.playing],
  );

  const retry = useCallback(
    (autoplay = false) => {
      if (!activeAudioFileId) return;
      setOperationError(undefined);
      player.pause();
      player.replace(sourceFor(activeAudioFileId));
      if (autoplay) player.play();
    },
    [activeAudioFileId, player],
  );

  const setPlaybackRate = useCallback(
    (rate: number) => {
      player.setPlaybackRate(rate, 'medium');
    },
    [player],
  );

  return useMemo(
    () => ({
      activeAudioFileId,
      activeRangeKey: activeRangeEnded ? undefined : activeRange?.key,
      currentTime: status.currentTime,
      duration: status.duration,
      error: operationError ?? status.error ?? undefined,
      isBuffering: status.isBuffering,
      isLoaded: status.isLoaded,
      isPlaying: status.playing,
      jumpBy,
      playRange,
      playbackRate: status.playbackRate,
      retry,
      seekTo,
      setPlaybackRate,
      toggleAudio,
      toggleFullPlayback,
    }),
    [
      activeAudioFileId,
      activeRange?.key,
      activeRangeEnded,
      jumpBy,
      operationError,
      playRange,
      retry,
      seekTo,
      setPlaybackRate,
      status.currentTime,
      status.duration,
      status.error,
      status.isBuffering,
      status.isLoaded,
      status.playbackRate,
      status.playing,
      toggleAudio,
      toggleFullPlayback,
    ],
  );
}
