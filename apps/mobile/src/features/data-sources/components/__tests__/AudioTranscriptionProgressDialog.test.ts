/**
 * 音频转写进度阶段文案测试。
 *
 * 锁定异步任务结果等待阶段对中文用户可见的明确说明。
 */
import { audioTranscriptionStageLabel } from '../AudioTranscriptionProgressDialog';

describe('audioTranscriptionStageLabel', () => {
  it('labels the provider callback wait explicitly', () => {
    expect(audioTranscriptionStageLabel('awaiting_result')).toBe('等待模型完成');
  });
});
