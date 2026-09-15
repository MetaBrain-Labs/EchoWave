/**
 * expo-audio Jest 状态替身。
 *
 * 在无原生音频模块的测试运行时模拟播放器加载、播放、暂停、跳转、换源和状态订阅。
 *
 * Responsibilities:
 * - 让页面测试可以观察真实控制器依赖的状态变化。
 * - 暴露最小测试驱动接口以模拟缓冲、结束和错误。
 *
 * Notes:
 * - 仅通过 Jest moduleNameMapper 使用，不进入应用 bundle。
 */
import { useEffect, useState } from 'react';

type MockAudioStatus = {
  currentTime: number;
  didJustFinish: boolean;
  duration: number;
  error: string | null;
  isBuffering: boolean;
  isLoaded: boolean;
  playbackRate: number;
  playing: boolean;
};

const initialStatus = (loaded: boolean): MockAudioStatus => ({
  currentTime: 0,
  didJustFinish: false,
  duration: loaded ? 600 : 0,
  error: null,
  isBuffering: false,
  isLoaded: loaded,
  playbackRate: 1,
  playing: false,
});

export class MockAudioPlayer {
  readonly pause = jest.fn(() => this.update({ playing: false }));
  readonly play = jest.fn(() => this.update({ isLoaded: true, playing: true }));
  readonly replace = jest.fn((source: unknown) => {
    this.source = source;
    this.status = initialStatus(Boolean(source));
    this.emit();
  });
  readonly seekTo = jest.fn(async (seconds: number) => {
    this.update({ currentTime: seconds, didJustFinish: false });
  });
  readonly setPlaybackRate = jest.fn((playbackRate: number) => {
    this.update({ playbackRate });
  });
  source: unknown;
  status: MockAudioStatus;
  private readonly listeners = new Set<() => void>();

  constructor(source: unknown) {
    this.source = source;
    this.status = initialStatus(Boolean(source));
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  update(next: Partial<MockAudioStatus>): void {
    this.status = { ...this.status, ...next };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export const mockAudioPlayers: MockAudioPlayer[] = [];
export const setAudioModeAsync = jest.fn(async () => undefined);

/** 录音状态替身，允许验证暂停与原生停止事件。 */
export class MockAudioRecorder {
  /** 更新原生事件回调，避免 hook 将实例作为不可变业务状态修改。 */
  setListener(listener?: MockAudioRecorder['listener']) {
    this.listener = listener;
  }

  uri = 'file:///documents/recording.m4a';
  status = {
    isRecording: false,
    durationMillis: 0,
    mediaServicesDidReset: false,
    canRecord: true,
    url: this.uri,
  };
  listener?: (status: {
    isFinished: boolean;
    hasError: boolean;
    error: string | null;
    url: string | null;
    mediaServicesDidReset: boolean;
    id: string;
  }) => void;
  listeners = new Set<() => void>();
  prepareToRecordAsync = jest.fn(async () => undefined);
  record = jest.fn(() => this.update({ isRecording: true }));
  pause = jest.fn(() => this.update({ isRecording: false }));
  stop = jest.fn(async () => this.update({ isRecording: false }));
  getStatus = () => this.status;
  update(next: Partial<MockAudioRecorder['status']>) {
    this.status = { ...this.status, ...next };
    for (const listener of this.listeners) listener();
  }
}
export const mockAudioRecorders: MockAudioRecorder[] = [];
export const AudioModule = {
  requestRecordingPermissionsAsync: jest.fn(async () => ({ granted: true })),
};
export const requestNotificationPermissionsAsync = jest.fn(async () => ({ granted: true }));
export const RecordingPresets = { HIGH_QUALITY: { extension: '.m4a' } };

/** 每个 Provider 持有一个替身实例。 */
export function useAudioRecorder(_options: unknown, listener?: MockAudioRecorder['listener']) {
  const [recorder] = useState(() => {
    const recorder = new MockAudioRecorder();
    mockAudioRecorders.push(recorder);
    return recorder;
  });
  useEffect(() => {
    recorder.setListener(listener);
  }, [recorder, listener]);
  return recorder;
}
/** 订阅替身的原生录音状态。 */
export function useAudioRecorderState(recorder: MockAudioRecorder) {
  const [status, setStatus] = useState(recorder.status);
  useEffect(() => {
    const listener = () => setStatus({ ...recorder.status });
    recorder.listeners.add(listener);
    return () => {
      recorder.listeners.delete(listener);
    };
  }, [recorder]);
  return status;
}

export function resetExpoAudioMock(): void {
  mockAudioPlayers.splice(0);
  mockAudioRecorders.splice(0);
  AudioModule.requestRecordingPermissionsAsync.mockReset().mockResolvedValue({ granted: true });
  requestNotificationPermissionsAsync.mockReset().mockResolvedValue({ granted: true });
  setAudioModeAsync.mockClear();
}

export function useAudioPlayer(source?: unknown): MockAudioPlayer {
  const [player] = useState(() => {
    const player = new MockAudioPlayer(source);
    mockAudioPlayers.push(player);
    return player;
  });
  return player;
}

export function useAudioPlayerStatus(player: MockAudioPlayer): MockAudioStatus {
  const [status, setStatus] = useState(player.status);
  useEffect(() => player.subscribe(() => setStatus({ ...player.status })), [player]);
  return status;
}
