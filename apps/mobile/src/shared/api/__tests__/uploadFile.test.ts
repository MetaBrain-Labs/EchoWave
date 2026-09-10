/**
 * 上传文件解析测试。
 *
 * 验证 Document Picker 缓存副本在上传前被解析为可上传 File，并还原原始文件名。
 *
 * Responsibilities:
 * - 覆盖缓存副本不可读、随机缓存名还原和名称已一致三种情况。
 *
 * Notes:
 * - 使用 jest-expo 的内存文件系统替身，不触碰真实文件系统。
 */
import { File, Paths } from 'expo-file-system';

import { resolveUploadFile } from '../uploadFile';

describe('resolveUploadFile', () => {
  it('returns undefined when the cached copy cannot be read', () => {
    expect(
      resolveUploadFile({
        name: '缺失.md',
        uri: 'file:///mock/cache/DocumentPicker/missing-copy.md',
        mimeType: 'text/markdown',
        size: 0,
        lastModified: 0,
      }),
    ).toBeUndefined();
  });

  it('restores the original file name on the generated cache copy', () => {
    const source = new File(Paths.cache, 'abc123.docx');
    source.create();
    source.write('docx-bytes');
    const sourceUri = source.uri;

    const resolved = resolveUploadFile({
      name: '季度报告.docx',
      uri: sourceUri,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: 10,
      lastModified: 0,
    });

    expect(resolved?.name).toBe('季度报告.docx');
    expect(resolved?.exists).toBe(true);
    expect(resolved?.textSync()).toBe('docx-bytes');
    expect(new File(sourceUri).exists).toBe(false);
  });

  it('replaces a stale same-name cache copy before renaming', () => {
    const source = new File(Paths.cache, 'def456.docx');
    source.create();
    source.write('new-bytes');
    const stale = new File(Paths.cache, '季度报告.docx');
    stale.create();
    stale.write('old-bytes');

    const resolved = resolveUploadFile({
      name: '季度报告.docx',
      uri: source.uri,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: 9,
      lastModified: 0,
    });

    expect(resolved?.textSync()).toBe('new-bytes');
  });

  it('keeps the cache copy untouched when names already match', () => {
    const source = new File(Paths.cache, 'matching.md');
    source.create();
    const sourceUri = source.uri;

    const resolved = resolveUploadFile({
      name: 'matching.md',
      uri: sourceUri,
      mimeType: 'text/markdown',
      size: 0,
      lastModified: 0,
    });

    expect(resolved?.uri).toBe(sourceUri);
  });
});
