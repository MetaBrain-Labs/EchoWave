/**
 * 模型调用显示名称本地化测试。
 *
 * 验证稳定执行操作名在英文界面不泄漏服务端中文 displayName，同时保留自定义名称。
 *
 * Responsibilities:
 * - 锁定 ASR 模型调用的中英文翻译映射。
 * - 锁定旧执行轨迹和未知自定义名称的兼容行为。
 *
 * Notes:
 * - 这里只测试显示名称映射，不启动 React Native 执行详情页面。
 */
import { en } from '@/shared/i18n/translations';
import { getModelCallNameKey } from '../ModelExecutionContent';

describe('getModelCallNameKey', () => {
  it('maps stable operations to localized model-call labels', () => {
    const key = getModelCallNameKey(
      'audio-file-transcription',
      '识别整段音频并生成带时间戳的说话人转写',
    );

    expect(key).toBe('execution.modelCall.audioFileTranscription');
    expect(key ? en[key] : undefined).toBe(
      'Recognize the full audio and produce timestamped speaker transcription',
    );
  });

  it('localizes legacy Chinese names but preserves custom names', () => {
    expect(getModelCallNameKey(undefined, '识别整段音频并生成带时间戳的说话人转写')).toBe(
      'execution.modelCall.audioFileTranscription',
    );
    expect(getModelCallNameKey('custom-operation', '用户自定义模型调用')).toBeUndefined();
  });
});
