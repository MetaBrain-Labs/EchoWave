/**
 * 移动端 API 地址配置。
 *
 * 集中读取并规范化 Expo 公共 API 地址，避免 feature 之间通过传输适配器共享配置。
 *
 * Responsibilities:
 * - 移除配置末尾的斜杠。
 * - Web 页面由 loopback 打开时，让 HTTP API 请求也通过同一 loopback 主机到达服务端。
 * - 为未配置的本地开发环境提供既有地址。
 *
 * Notes:
 * - `EXPO_PUBLIC_*` 会进入客户端 bundle，不得包含秘密。
 */

const DEFAULT_API_URL = 'http://localhost:3001';

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
  const normalized = (configuredUrl?.trim() || DEFAULT_API_URL).replace(/\/+$/, '');
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

/** 当前移动端请求使用的 EchoWave API 根地址。 */
export const apiUrl = resolveApiUrl(
  process.env.EXPO_PUBLIC_API_URL,
  typeof window !== 'undefined' ? window.location?.hostname : undefined,
);

/** 返回不经过 JSON 适配器的租户内音频媒体地址。 */
export function audioPlaybackUrl(audioFileId: string): string {
  return `${apiUrl}/api/audio-files/${encodeURIComponent(audioFileId)}/content`;
}
