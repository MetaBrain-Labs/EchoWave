/**
 * 后置分析控件的轻量模式恢复测试。
 *
 * 验证未请求或最终失败的声学情绪版本不会暴露独立重跑入口，只允许重新选择原音频。
 *
 * Responsibilities:
 * - 锁定声学情绪不可补跑的移动端交互边界。
 */
import { fireEvent, render } from '@testing-library/react-native';

import { setPostAnalysisControlsCollapsedPreference } from '../../preferences';
import { PostAnalysisControls } from '../PostAnalysisControls';

describe('PostAnalysisControls lightweight acoustic recovery', () => {
  beforeEach(() => setPostAnalysisControlsCollapsedPreference(false));

  it('hides the standalone emotion action when acoustic analysis was not requested', () => {
    const onRemountSource = jest.fn();
    const screen = render(
      <PostAnalysisControls
        confirmed
        emotion={{ state: 'not_requested', reason: 'acoustic_emotion_not_enabled' }}
        onRemountSource={onRemountSource}
        onStart={jest.fn()}
        role={{ state: 'idle' }}
      />,
    );

    expect(screen.queryByRole('button', { name: '情绪分析' })).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: '重新选择源音频并创建新转写' }));
    expect(onRemountSource).toHaveBeenCalledTimes(1);
  });

  it('replaces the final bundled-emotion retry with source remount', () => {
    const screen = render(
      <PostAnalysisControls
        confirmed
        emotion={{
          state: 'failed',
          jobId: '11111111-1111-4111-8111-111111111111',
          model: 'qwen3.5-omni-flash',
          code: 'PROVIDER_ERROR',
          message: '声学分析最终失败。',
          retryable: false,
          confirmationVersion: 1,
          requiresSourceRemount: true,
        }}
        onRemountSource={jest.fn()}
        onStart={jest.fn()}
        role={{ state: 'idle' }}
      />,
    );

    expect(screen.queryByRole('button', { name: '重新分析' })).toBeNull();
    expect(screen.getByText(/请重新选择原音频并创建新转写/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '重新选择源音频并创建新转写' })).toBeTruthy();
  });

  it('marks lightweight bundled emotion as completed during transcription', () => {
    const onStart = jest.fn();
    const screen = render(
      <PostAnalysisControls
        confirmed
        emotion={{
          state: 'ready',
          jobId: '11111111-1111-4111-8111-111111111111',
          model: 'qwen3.5-omni-flash',
          completedAt: '2026-09-03T03:00:00.000Z',
          confirmationVersion: 1,
        }}
        onStart={onStart}
        role={{ state: 'idle' }}
        runtimeMode="lightweight_local"
      />,
    );

    expect(screen.getByText(/已在转写时完成声学情绪分析/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '重新分析' })).toBeNull();
    expect(onStart).not.toHaveBeenCalled();
  });
});
