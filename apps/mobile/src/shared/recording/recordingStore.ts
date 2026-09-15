/**
 * 手机录音原件与草稿持久化。
 *
 * 只保存本机录音和操作引用，不缓存服务端资源或分析结果。
 *
 * Responsibilities:
 * - 校验版本化草稿并原子发布元数据。
 * - 保留手机原件、服务器身份和可恢复操作快照。
 *
 * Notes:
 * - Web 不创建本机录音；文件定位基于文档目录，兼容 iOS 沙箱路径变化。
 */
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { RecordingDraftSchema, type RecordingDraft } from '@echowave/contracts';
export { RecordingDraftSchema, type RecordingDraft } from '@echowave/contracts';

function directory() {
  const dir = new Directory(Paths.document, 'recordings');
  dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/** 解析受控文档目录下的原件，拒绝任意绝对路径。 */
export function recordingFile(draft: RecordingDraft): File {
  const parsed = RecordingDraftSchema.parse(draft);
  return new File(Paths.document, parsed.path);
}

/** 先写临时元数据，再替换已发布草稿，保存失败不删除原音频。 */
export async function saveRecordingDraft(draft: RecordingDraft): Promise<void> {
  const parsed = RecordingDraftSchema.parse(draft);
  const dir = directory();
  const pending = new File(dir, `${parsed.id}.pending`);
  pending.write(JSON.stringify(parsed));
  await pending.move(new File(dir, `${parsed.id}.json`), { overwrite: true });
}

/** 恢复本机草稿；中断录音保留文件并明确标记，不恢复麦克风采集。 */
export async function readRecordingDrafts(
  onError?: (error: unknown) => void,
): Promise<RecordingDraft[]> {
  if (Platform.OS === 'web') return [];
  const drafts = new Map<string, RecordingDraft>();
  // 未完成原子发布的 pending 也可恢复；损坏的单条记录不能隐藏其他原件。
  const files = directory()
    .list()
    .filter((file): file is File => file instanceof File && /\.(json|pending)$/.test(file.name));
  files.sort((a, b) => Number(a.name.endsWith('.pending')) - Number(b.name.endsWith('.pending')));
  for (const file of files) {
    try {
      const draft = RecordingDraftSchema.parse(JSON.parse(await file.text()));
      if (draft.state === 'recording') {
        draft.state = 'local';
        draft.interrupted = true;
        const audio = recordingFile(draft);
        draft.sizeBytes = audio.exists ? audio.size : 0;
      }
      drafts.set(draft.id, draft);
      if (file.name.endsWith('.pending') || draft.interrupted) await saveRecordingDraft(draft);
    } catch (error) {
      onError?.(error);
    }
  }
  return [...drafts.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** 显式删除当前手机原件及其元数据，不向服务器发起删除请求。 */
export function deleteRecordingDraft(draft: RecordingDraft): void {
  const file = recordingFile(draft);
  if (file.exists) file.delete();
  const metadata = new File(directory(), `${draft.id}.json`);
  if (metadata.exists) metadata.delete();
  const pending = new File(directory(), `${draft.id}.pending`);
  if (pending.exists) pending.delete();
}

/** 上传前验证本机原件与既有服务端大小及时长限制。 */
export function recordingAsset(draft: RecordingDraft) {
  const file = recordingFile(draft);
  if (!file.exists || file.size <= 0 || draft.durationMs <= 0)
    throw new Error('recording.fileUnavailable');
  if (file.size > 200 * 1024 * 1024 || draft.durationMs > 12 * 60 * 60 * 1000)
    throw new Error('recording.tooLarge');
  return {
    uri: file.uri,
    name: `${draft.title.replace(/[\\/:*?"<>|]/g, '_')}.m4a`,
    mimeType: 'audio/mp4',
    size: file.size,
    lastModified: new Date(draft.createdAt).getTime(),
  };
}
