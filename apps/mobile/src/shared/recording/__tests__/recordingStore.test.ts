/**
 * 录音文档目录持久化回归。
 *
 * 验证未发布元数据恢复、损坏隔离和手机原件独立删除。
 *
 * Responsibilities:
 * - 在文件系统边界模拟强制终止与写入失败。
 *
 * Notes:
 * - 不模拟服务端权威数据。
 */
import { deleteRecordingDraft, readRecordingDrafts, saveRecordingDraft } from '../recordingStore';
import type { RecordingDraft } from '@echowave/contracts';
const mockFiles = new Map<string, string>();
let mockWriteFailure = false;
jest.mock('expo-file-system', () => {
  class File {
    uri: string;
    constructor(...parts: ({ uri: string } | string)[]) {
      this.uri = parts.map((part) => (typeof part === 'string' ? part : part.uri)).join('/');
    }
    get name() {
      return this.uri.split('/').at(-1)!;
    }
    get exists() {
      return mockFiles.has(this.uri);
    }
    get size() {
      return mockFiles.get(this.uri)?.length ?? 0;
    }
    text() {
      return Promise.resolve(mockFiles.get(this.uri)!);
    }
    write(value: string) {
      if (mockWriteFailure) throw new Error('disk full');
      mockFiles.set(this.uri, value);
    }
    async move(target: File) {
      mockFiles.set(target.uri, mockFiles.get(this.uri)!);
      mockFiles.delete(this.uri);
    }
    delete() {
      mockFiles.delete(this.uri);
    }
  }
  class Directory {
    uri: string;
    constructor(...parts: ({ uri: string } | string)[]) {
      this.uri = parts.map((part) => (typeof part === 'string' ? part : part.uri)).join('/');
    }
    create() {}
    list() {
      return [...mockFiles.keys()]
        .filter((key) => key.startsWith(`${this.uri}/`))
        .map((key) => new File(key));
    }
  }
  return { Directory, File, Paths: { document: { uri: 'file:///documents' } } };
});
const draft: RecordingDraft = {
  version: 1,
  id: '11111111-1111-4111-8111-111111111111',
  title: 'recording',
  createdAt: '2026-09-15T00:00:00.000Z',
  path: 'original.m4a',
  durationMs: 2000,
  sizeBytes: 0,
  serverUrl: '',
  dataSourceId: '',
  interrupted: false,
  state: 'recording',
};
describe('recordingStore', () => {
  beforeEach(() => {
    mockFiles.clear();
    mockWriteFailure = false;
    mockFiles.set('file:///documents/original.m4a', 'audio-data');
  });
  it('recovers an interrupted pending draft and never resumes microphone collection', async () => {
    mockFiles.set(`file:///documents/recordings/${draft.id}.pending`, JSON.stringify(draft));
    const records = await readRecordingDrafts();
    expect(records).toEqual([
      expect.objectContaining({
        state: 'local',
        interrupted: true,
        sizeBytes: 10,
        durationMs: 2000,
      }),
    ]);
    expect(mockFiles.has(`file:///documents/recordings/${draft.id}.json`)).toBe(true);
  });
  it('isolates corrupt metadata while retaining readable originals', async () => {
    await saveRecordingDraft({ ...draft, state: 'local' });
    mockFiles.set('file:///documents/recordings/corrupt.json', '{');
    const warning = jest.fn();
    const records = await readRecordingDrafts(warning);
    expect(records).toHaveLength(1);
    expect(warning).toHaveBeenCalledTimes(1);
    expect(mockFiles.has('file:///documents/original.m4a')).toBe(true);
  });
  it('retains the previous metadata and original when a write fails', async () => {
    await saveRecordingDraft({ ...draft, state: 'local' });
    mockWriteFailure = true;
    await expect(saveRecordingDraft({ ...draft, title: 'new title' })).rejects.toThrow('disk full');
    expect(mockFiles.has('file:///documents/original.m4a')).toBe(true);
    expect(
      JSON.parse(mockFiles.get(`file:///documents/recordings/${draft.id}.json`)!),
    ).toHaveProperty('title', 'recording');
  });
  it('deletes only the explicit phone original and its local metadata', async () => {
    await saveRecordingDraft(draft);
    mockFiles.set('server-asset', 'server-authority');
    deleteRecordingDraft(draft);
    expect(mockFiles.has('file:///documents/original.m4a')).toBe(false);
    expect(mockFiles.has(`file:///documents/recordings/${draft.id}.json`)).toBe(false);
    expect(mockFiles.get('server-asset')).toBe('server-authority');
  });
});
