/**
 * 移动端上传文件解析。
 *
 * 将 Document Picker 的缓存副本解析为 expo/fetch 可编码的 File，并还原原始文件名。
 *
 * Responsibilities:
 * - 校验缓存副本是否可读。
 * - 将随机缓存文件名还原为选择器提供的原始名称。
 *
 * Notes:
 * - 服务端以 multipart 文件名作为业务标题，因此上传前必须保留原始名称。
 * - 仅用于原生 multipart 上传；Web 平台直接使用选择器返回的 File。
 */
import type { DocumentPickerAsset } from 'expo-document-picker';
import { File } from 'expo-file-system';

/** 解析可上传的 File；缓存副本不可读时返回 undefined。 */
export function resolveUploadFile(asset: DocumentPickerAsset): File | undefined {
  const file = new File(asset.uri);
  if (!file.exists) return undefined;
  // Document Picker 会把选中文件复制为随机命名的缓存副本，而服务端使用 multipart 文件名作为标题，因此上传前先还原原始文件名。
  if (file.name !== asset.name) {
    const target = new File(file.parentDirectory, asset.name);
    if (target.exists) target.delete();
    file.rename(asset.name);
  }
  return file;
}
