/**
 * 文档选择器互斥封装测试。
 *
 * 验证重复调用不会再次触发 Expo 原生选择器，并确认原始请求结束后互斥状态能够释放。
 *
 * Responsibilities:
 * - 覆盖选择器进行中的重复调用。
 * - 覆盖选择器失败后的状态恢复。
 *
 * Notes:
 * - 不启动真实系统文件选择器，只验证封装边界。
 */
import * as DocumentPicker from 'expo-document-picker';

import { pickDocumentAsync } from '../documentPicker';

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(),
}));

describe('pickDocumentAsync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('ignores concurrent calls and releases the lock after completion', async () => {
    let resolveFirst!: (value: Awaited<ReturnType<typeof DocumentPicker.getDocumentAsync>>) => void;
    jest.mocked(DocumentPicker.getDocumentAsync).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );

    const first = pickDocumentAsync({ type: 'audio/*' });
    await expect(pickDocumentAsync({ type: 'audio/*' })).resolves.toBeUndefined();
    expect(DocumentPicker.getDocumentAsync).toHaveBeenCalledTimes(1);

    resolveFirst({ canceled: true, assets: null });
    await first;

    jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValueOnce({
      canceled: true,
      assets: null,
    });
    await expect(pickDocumentAsync({ type: 'audio/*' })).resolves.toEqual({
      canceled: true,
      assets: null,
    });
    expect(DocumentPicker.getDocumentAsync).toHaveBeenCalledTimes(2);
  });

  it('releases the lock when the native picker rejects', async () => {
    jest.mocked(DocumentPicker.getDocumentAsync).mockRejectedValueOnce(new Error('picker failed'));
    await expect(pickDocumentAsync({ type: 'audio/*' })).rejects.toThrow('picker failed');

    jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValueOnce({
      canceled: true,
      assets: null,
    });
    await expect(pickDocumentAsync({ type: 'audio/*' })).resolves.toEqual({
      canceled: true,
      assets: null,
    });
  });
});
