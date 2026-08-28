/**
 * 音频内容 HTTP Range 解析。
 *
 * 将单区间 Range 请求解析为文件读取边界，供音频流接口生成稳定的 200、206 和 416 响应。
 *
 * Responsibilities:
 * - 支持闭区间、开放尾区间和后缀区间。
 * - 拒绝多区间、越界和格式非法的请求。
 *
 * Notes:
 * - 本模块只处理 HTTP 字节范围，不访问数据库或文件系统。
 */

export type AudioByteRange =
  | { kind: 'full'; start: number; end: number }
  | { kind: 'partial'; start: number; end: number }
  | { kind: 'unsatisfiable' };

/** 将可选 Range 请求头解析为单个可读取字节区间。 */
export function resolveAudioByteRange(
  rangeHeader: string | undefined,
  size: number,
): AudioByteRange {
  if (!Number.isSafeInteger(size) || size <= 0) return { kind: 'unsatisfiable' };
  if (!rangeHeader) return { kind: 'full', start: 0, end: size - 1 };
  if (rangeHeader.includes(',')) return { kind: 'unsatisfiable' };

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return { kind: 'unsatisfiable' };
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return { kind: 'unsatisfiable' };

  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return { kind: 'unsatisfiable' };
    }
    return {
      kind: 'partial',
      start: Math.max(size - suffixLength, 0),
      end: size - 1,
    };
  }

  const start = Number(rawStart);
  const requestedEnd = rawEnd ? Number(rawEnd) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    start >= size ||
    requestedEnd < start
  ) {
    return { kind: 'unsatisfiable' };
  }
  return { kind: 'partial', start, end: Math.min(requestedEnd, size - 1) };
}
