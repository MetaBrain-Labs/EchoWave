/**
 * Office 容器安全检查。
 *
 * 在 Word 与 Spreadsheet 解析前校验 ZIP 容器、必要入口和解压大小。
 *
 * Responsibilities:
 * - 阻止损坏、伪造或解压过大的 Office 文件。
 *
 * Notes:
 * - 不解释文档正文。
 */
import JSZip from 'jszip';

import { DocumentParseError } from './parserTypes.ts';

const MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;

export async function inspectOfficeArchive(buffer: Buffer, requiredEntry: string): Promise<void> {
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new DocumentParseError('INVALID_FILE', 'Office 文件不是有效的 ZIP 容器。');
  }
  let archive: JSZip;
  try {
    archive = await JSZip.loadAsync(buffer, { checkCRC32: true });
  } catch {
    throw new DocumentParseError('INVALID_FILE', 'Office 文件已损坏或无法解压。');
  }
  if (!archive.file(requiredEntry)) {
    throw new DocumentParseError('INVALID_FILE', '文件内容与扩展名不匹配。');
  }

  let uncompressedBytes = 0;
  for (const entry of Object.values(archive.files)) {
    const data = (entry as unknown as { _data?: { uncompressedSize?: number } })._data;
    uncompressedBytes += data?.uncompressedSize ?? 0;
    if (uncompressedBytes > MAX_UNCOMPRESSED_BYTES) {
      throw new DocumentParseError('DOCUMENT_TOO_LARGE', '解压后的文件内容超过 100 MB。');
    }
  }
}
