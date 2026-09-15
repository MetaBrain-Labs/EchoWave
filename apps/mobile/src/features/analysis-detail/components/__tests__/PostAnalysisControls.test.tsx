/**
 * 后置分析控件的轻量模式恢复测试。
 *
 * 验证轻量声学补跑入口与匹配原件恢复提示。
 *
 * Responsibilities:
 * - 锁定确认正文后可补跑且不重新转写的移动端边界。
 */
import { fireEvent, render } from '@testing-library/react-native';

import { setPostAnalysisControlsCollapsedPreference } from '../../preferences';
import { PostAnalysisControls } from '../PostAnalysisControls';

describe('PostAnalysisControls lightweight acoustic recovery', () => {
  beforeEach(() => setPostAnalysisControlsCollapsedPreference(false));

  it('allows later emotion on a confirmed transcription-only result', () => {
    const onRemountSource = jest.fn();
    const onStart = jest.fn();
    const screen = render(
      <PostAnalysisControls
        confirmed
        emotion={{ state: 'not_requested', reason: 'acoustic_emotion_not_enabled' }}
        onRemountSource={onRemountSource}
        onStart={onStart}
        role={{ state: 'idle' }}
      />,
    );

    fireEvent.press(screen.getByRole('button', { name: '情绪分析' }));
    expect(onStart).toHaveBeenCalledWith('emotion');
    expect(onRemountSource).not.toHaveBeenCalled();
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
          language: 'zh-CN',
          requiresSourceRemount: true,
        }}
        onRemountSource={jest.fn()}
        onStart={jest.fn()}
        role={{ state: 'idle' }}
      />,
    );

    expect(screen.queryByRole('button', { name: '重新分析' })).toBeNull();
    expect(screen.getByText(/请重新挂载匹配原件后补跑/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '重新挂载原件' })).toBeTruthy();
  });

  it('allows explicit lightweight emotion reruns after completion', () => {
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
          language: 'zh-CN',
        }}
        onStart={onStart}
        role={{ state: 'idle' }}
        runtimeMode="lightweight_local"
      />,
    );

    expect(screen.getByText(/已完成/)).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: '重新分析' }));
    expect(onStart).toHaveBeenCalledWith('emotion');
  });
});
