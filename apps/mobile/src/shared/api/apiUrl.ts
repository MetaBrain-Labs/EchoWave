/**
 * 移动端 API 地址配置。
 *
 * 保留 Web 开发地址兼容解析，并转发运行时服务器地址访问器。
 *
 * Responsibilities:
 * - 移除配置末尾的斜杠。
 * - Web 页面由 loopback 打开时，让 HTTP API 请求也通过同一 loopback 主机到达服务端。
 * - 让旧调用方逐步迁移到运行时服务器配置。
 *
 * Notes:
 * - `EXPO_PUBLIC_*` 会进入客户端 bundle，不得包含秘密。
 */
import { getApiUrl as getRuntimeApiUrl } from './serverUrl';

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  return (
    normalized === 'localhost' || normalized === '::1' || /^127(?:\.\d{1,3}){3}$/.test(normalized)
  );
}

/**
 * 解析当前客户端应使用的 API 地址。
 *
 * Web 开发页若通过 localhost/loopback 打开，必须让明文 HTTP API 请求也真正连接 loopback；
 * 仅修改浏览器侧 HTTP 地址，原生端、远程页面与 HTTPS 地址保持显式配置不变。
 */
export function resolveApiUrl(configuredUrl: string | undefined, browserHostname?: string): string {
  const normalized = (configuredUrl?.trim() || 'http://localhost:3001').replace(/\/+$/, '');
  if (!browserHostname || !isLoopbackHostname(browserHostname)) return normalized;

  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== 'http:' || isLoopbackHostname(parsed.hostname)) return normalized;
    const hostname = browserHostname.replace(/^\[|\]$/g, '');
    parsed.hostname = hostname.includes(':') ? `[${hostname}]` : hostname;
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return normalized;
  }
}

/** 在请求发生时读取当前服务器，并保留 Web loopback 开发兼容行为。 */
export function getApiUrl(): string {
  return resolveApiUrl(
    getRuntimeApiUrl(),
    typeof window !== 'undefined' ? window.location?.hostname : undefined,
  );
}

/** 返回不经过 JSON 适配器的租户内音频媒体地址。 */
export function audioPlaybackUrl(audioFileId: string): string {
  return `${getApiUrl()}/api/audio-files/${encodeURIComponent(audioFileId)}/content`;
}
