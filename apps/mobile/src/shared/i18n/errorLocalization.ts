/**
 * 稳定 API 错误码本地化。
 *
 * 请求层只依赖当前 App 语言与稳定错误码，英文界面不会直接展示服务端中文兜底正文。
 *
 * Responsibilities:
 * - 保存请求设施可读取的当前语言镜像。
 * - 将已知和未知错误码转换为安全的本地化说明。
 */
import type { SupportedLanguage } from '@echowave/contracts';

let currentLanguage: SupportedLanguage = 'zh-CN';

/** 同步 Provider 已水合的语言，供 React 树之外的请求层使用。 */
export function setRequestLanguage(language: SupportedLanguage): void {
  currentLanguage = language;
}

const englishMessages: Record<string, string> = {
  BAD_REQUEST: 'The request is invalid.',
  CONFLICT: 'The operation conflicts with the current resource state.',
  NOT_FOUND: 'The requested data was not found.',
  TIMEOUT: 'The request timed out. Please try again.',
  NETWORK: 'Unable to connect to the service. Check your network.',
  INVALID_RESPONSE: 'The service returned an invalid response.',
  HTTP_ERROR: 'The service request failed.',
};

/** 按当前 App 语言生成安全错误正文；英文未知错误只展示通用说明与错误码。 */
export function localizeRequestError(code: string, serverMessage: string): string {
  if (currentLanguage === 'zh-CN') return serverMessage;
  return englishMessages[code] ?? `Something went wrong. Please try again. Error code: ${code}`;
}
