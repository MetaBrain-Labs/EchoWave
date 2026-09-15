/**
 * 应用级录音控制器交互回归。
 *
 * 验证授权拒绝、暂停继续、结束保存及原生中断不会隐式上传。
 *
 * Responsibilities:
 * - 在无设备运行时验证录音生命周期与本机保存边界。
 *
 * Notes:
 * - 后台录音持续能力仍需原生设备验证。
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Platform, Text, Pressable } from 'react-native';
import { RecordingProvider, useRecording } from '../RecordingProvider';
import {
  AudioModule,
  mockAudioRecorders,
  requestNotificationPermissionsAsync,
  resetExpoAudioMock,
} from '@/test/ExpoAudioMock';
import { saveRecordingDraft } from '../recordingStore';
jest.mock('expo-file-system', () => ({ Paths: { document: { uri: 'file:///documents/' } } }));
jest.mock('../recordingStore', () => ({
  readRecordingDrafts: jest.fn(async () => []),
  saveRecordingDraft: jest.fn(async () => undefined),
  deleteRecordingDraft: jest.fn(),
  recordingFile: jest.fn(() => ({ exists: true, size: 1024 })),
}));
/** 用实际 Provider 驱动录音命令，不替换业务状态机。 */
function Controls() {
  const recording = useRecording();
  return (
    <>
      <Pressable onPress={() => void recording.start('https://example.com', 'source')}>
        <Text>start</Text>
      </Pressable>
      <Pressable onPress={() => void recording.pause()}>
        <Text>pause</Text>
      </Pressable>
      <Pressable onPress={() => void recording.resume()}>
        <Text>resume</Text>
      </Pressable>
      <Pressable onPress={() => void recording.stop()}>
        <Text>stop</Text>
      </Pressable>
      <Text>{recording.error}</Text>
      <Text testID="drafts">
        {recording.drafts.filter((draft) => draft.state === 'local').length}
      </Text>
    </>
  );
}
describe('RecordingProvider', () => {
  const originalPlatform = Platform.OS;
  beforeEach(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
    resetExpoAudioMock();
    jest.mocked(saveRecordingDraft).mockClear();
  });
  afterAll(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: originalPlatform });
  });
  it('does not create a draft when microphone permission is denied', async () => {
    AudioModule.requestRecordingPermissionsAsync.mockResolvedValueOnce({ granted: false });
    const screen = render(
      <RecordingProvider>
        <Controls />
      </RecordingProvider>,
    );
    await act(async () => {
      fireEvent.press(screen.getByText('start'));
    });
    expect(saveRecordingDraft).not.toHaveBeenCalled();
    expect(mockAudioRecorders[0].record).not.toHaveBeenCalled();
  });
  it('requests Android notification permission before preparing background recording', async () => {
    requestNotificationPermissionsAsync.mockResolvedValueOnce({ granted: false });
    const screen = render(
      <RecordingProvider>
        <Controls />
      </RecordingProvider>,
    );
    await act(async () => {
      fireEvent.press(screen.getByText('start'));
    });
    expect(requestNotificationPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(mockAudioRecorders[0].prepareToRecordAsync).not.toHaveBeenCalled();
    expect(saveRecordingDraft).not.toHaveBeenCalled();
  });
  it('preserves the same recorder through pause, resume and final save', async () => {
    const screen = render(
      <RecordingProvider>
        <Controls />
      </RecordingProvider>,
    );
    await act(async () => {
      fireEvent.press(screen.getByText('start'));
    });
    await act(async () => {
      mockAudioRecorders[0].update({ durationMillis: 1000 });
    });
    await act(async () => {
      fireEvent.press(screen.getByText('pause'));
    });
    await act(async () => {
      fireEvent.press(screen.getByText('resume'));
    });
    await act(async () => {
      fireEvent.press(screen.getByText('stop'));
    });
    expect(mockAudioRecorders).toHaveLength(1);
    expect(mockAudioRecorders[0].record).toHaveBeenCalledTimes(2);
    expect(saveRecordingDraft).toHaveBeenLastCalledWith(
      expect.objectContaining({
        state: 'local',
        interrupted: false,
        durationMs: 1000,
        sizeBytes: 1024,
      }),
    );
    expect(screen.getByTestId('drafts').props.children).toBe(1);
  });
  it('retains the original after a native interruption and never resumes automatically', async () => {
    const screen = render(
      <RecordingProvider>
        <Controls />
      </RecordingProvider>,
    );
    await act(async () => {
      fireEvent.press(screen.getByText('start'));
      mockAudioRecorders[0].update({ durationMillis: 1000 });
    });
    await act(async () => {
      mockAudioRecorders[0].listener?.({
        id: 'native',
        isFinished: true,
        hasError: true,
        error: 'interrupted',
        url: mockAudioRecorders[0].uri,
        mediaServicesDidReset: false,
      });
    });
    await waitFor(() =>
      expect(saveRecordingDraft).toHaveBeenLastCalledWith(
        expect.objectContaining({ state: 'local', interrupted: true }),
      ),
    );
    expect(mockAudioRecorders[0].record).toHaveBeenCalledTimes(1);
  });
});
