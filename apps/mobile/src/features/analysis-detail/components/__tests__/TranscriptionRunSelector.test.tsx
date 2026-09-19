/**
 * ASR 版本选择器测试。
 *
 * 验证声学情绪属性只在轻量本地模式下展示，避免把不适用该模式的属性显示为“未启用”。
 *
 * Responsibilities:
 * - 锁定轻量模式显示声学情绪开关状态。
 * - 锁定其他模式只显示状态与语言。
 *
 * Notes:
 * - 只验证展示文本，不覆盖版本切换动作。
 */
import type { AudioTranscriptionRunListResponse } from '@echowave/contracts';
import { render } from '@testing-library/react-native';

import { TranscriptionRunSelector } from '../TranscriptionRunSelector';

const runs: AudioTranscriptionRunListResponse = {
  selectionMode: 'auto',
  items: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      revision: 6,
      status: 'ready',
      model: 'qwen-audio-3.0-asr-flash-filetrans',
      includeAcousticEmotion: false,
      language: 'zh-CN',
      active: true,
      createdAt: '2026-09-17T00:00:00.000Z',
      completedAt: '2026-09-17T00:10:00.000Z',
    },
  ],
} as AudioTranscriptionRunListResponse;

const props = { onAuto: jest.fn(), onSelect: jest.fn(), pending: false, runs };

describe('TranscriptionRunSelector acoustic emotion scope', () => {
  it('shows the per-run acoustic emotion state in lightweight mode', () => {
    const screen = render(<TranscriptionRunSelector {...props} runtimeMode="lightweight_local" />);

    expect(screen.getByText('就绪 · 声学情绪未启用 · 中文')).toBeTruthy();
  });

  it('omits the acoustic emotion attribute outside lightweight mode', () => {
    for (const runtimeMode of ['hybrid', 'object_storage'] as const) {
      const screen = render(<TranscriptionRunSelector {...props} runtimeMode={runtimeMode} />);

      expect(screen.getByText('就绪 · 中文')).toBeTruthy();
      expect(screen.queryByText(/声学情绪/)).toBeNull();
    }
  });
});
