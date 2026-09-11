/**
 * 文档选择器互斥封装。
 *
 * 统一协调 Expo 原生文档选择器的调用，避免多个页面或重复点击在同一时间启动多个
 * getDocumentAsync 操作。
 *
 * Responsibilities:
 * - 保证应用内同一时间只有一个文档选择器请求。
 * - 在选择器完成、取消或失败后释放互斥状态。
 *
 * Notes:
 * - 并发调用会直接返回 undefined，由调用方视为本次操作被忽略。
 */
import * as DocumentPicker from 'expo-document-picker';

type DocumentPickerOptions = Parameters<typeof DocumentPicker.getDocumentAsync>[0];
type DocumentPickerResult = Awaited<ReturnType<typeof DocumentPicker.getDocumentAsync>>;

let documentPicking = false;

/** 在应用内安全地启动一次文档选择，忽略仍有选择器运行时的重复调用。 */
export async function pickDocumentAsync(
  options: DocumentPickerOptions,
): Promise<DocumentPickerResult | undefined> {
  if (documentPicking) return undefined;

  documentPicking = true;
  try {
    return await DocumentPicker.getDocumentAsync(options);
  } finally {
    documentPicking = false;
  }
}
