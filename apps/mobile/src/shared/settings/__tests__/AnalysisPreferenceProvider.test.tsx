/**
 * 默认分析方式持久化回归。
 *
 * 验证偏好水合和保存失败时保留原选择。
 *
 * Responsibilities:
 * - 保证仅转写关闭后续分析并保留人工确认。
 *
 * Notes:
 * - 不调用服务端设置接口。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';
import {
  AnalysisPreferenceProvider,
  pipelineForPreference,
  useAnalysisPreference,
} from '../AnalysisPreferenceProvider';
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));
/** 使用真实偏好 Provider 验证选择与写入边界。 */
function Controls() {
  const state = useAnalysisPreference();
  return (
    <>
      <Text>{state.preference}</Text>
      <Pressable
        onPress={() => void state.setPreference('transcription_only').catch(() => undefined)}
      >
        <Text>change</Text>
      </Pressable>
    </>
  );
}
describe('AnalysisPreferenceProvider', () => {
  beforeEach(() => {
    jest.mocked(AsyncStorage.getItem).mockResolvedValue(null);
    jest.mocked(AsyncStorage.setItem).mockResolvedValue(undefined);
  });
  it('restores transcription-only preference with manual confirmation', async () => {
    jest.mocked(AsyncStorage.getItem).mockResolvedValue('transcription_only');
    const screen = render(
      <AnalysisPreferenceProvider>
        <Controls />
      </AnalysisPreferenceProvider>,
    );
    await waitFor(() => expect(screen.getByText('transcription_only')).toBeTruthy());
    expect(pipelineForPreference('transcription_only')).toMatchObject({
      confirmation: 'manual',
      includeEmotion: false,
      includeRole: false,
      includeBusinessAnalysis: false,
    });
  });
  it('keeps full workflow when persistence fails', async () => {
    jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('disk full'));
    const screen = render(
      <AnalysisPreferenceProvider>
        <Controls />
      </AnalysisPreferenceProvider>,
    );
    await act(async () => {
      fireEvent.press(screen.getByText('change'));
    });
    expect(screen.getByText('full')).toBeTruthy();
  });
});
