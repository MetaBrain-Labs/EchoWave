/**
 * EchoWave 运行时服务器地址。
 *
 * 规范化用户选择的服务器根地址，并为所有传输适配器保存当前内存快照。
 *
 * Responsibilities:
 * - 限制可接受的协议、地址范围和 URL 结构。
 * - 让 REST、SSE、上传与媒体请求在调用时读取同一个地址。
 *
 * Notes:
 * - 持久化生命周期由 ServerConnectionProvider 管理。
 */

/** 服务器地址校验失败的稳定类别。 */
export type ServerUrlErrorCode =
  | 'EMPTY'
  | 'INVALID_URL'
  | 'INVALID_PROTOCOL'
  | 'CREDENTIALS_NOT_ALLOWED'
  | 'PATH_NOT_ALLOWED'
  | 'PUBLIC_HTTP_NOT_ALLOWED'
  | 'UNCONFIGURED';

/** 可安全展示给连接页面的服务器地址错误。 */
export class ServerUrlError extends Error {
  constructor(
    public readonly code: ServerUrlErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ServerUrlError';
  }
}

function isPrivateIpv4(hostname: string): boolean {
  const octets = hostname.split('.').map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value > 255)) {
    return false;
  }
  const [first = -1, second = -1] = octets;
  return (
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 100 && second >= 64 && second <= 127)
  );
}

function isPrivateIpv6(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return (
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    /^fe[89ab]/.test(normalized)
  );
}

/** 判断主机是否属于可使用明文 HTTP 的本地或私有网络。 */
export function isLocalServerHost(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    isPrivateIpv4(normalized) ||
    isPrivateIpv6(normalized)
  );
}

/** 校验并返回无尾斜杠的服务器 origin。 */
export function normalizeServerUrl(value: string): string {
  const input = value.trim();
  if (!input) throw new ServerUrlError('EMPTY', '请输入服务器地址。');

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new ServerUrlError('INVALID_URL', '服务器地址不是有效的完整 URL。');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ServerUrlError('INVALID_PROTOCOL', '服务器地址只支持 HTTP 或 HTTPS。');
  }
  if (parsed.username || parsed.password) {
    throw new ServerUrlError('CREDENTIALS_NOT_ALLOWED', '服务器地址不能包含用户名或密码。');
  }
  if ((parsed.pathname && parsed.pathname !== '/') || parsed.search || parsed.hash) {
    throw new ServerUrlError('PATH_NOT_ALLOWED', '请输入服务器根地址，不要包含路径、参数或锚点。');
  }
  if (parsed.protocol === 'http:' && !isLocalServerHost(parsed.hostname)) {
    throw new ServerUrlError('PUBLIC_HTTP_NOT_ALLOWED', '公网服务器必须使用 HTTPS。');
  }
  return parsed.origin;
}

function developmentDefaultUrl(): string | null {
  if (process.env.EXPO_PUBLIC_REQUIRE_SERVER_SELECTION === 'true') return null;
  const configured =
    process.env.EXPO_PUBLIC_API_URL ||
    (process.env.NODE_ENV === 'test' ? 'http://localhost:3001' : undefined);
  if (!configured) return null;
  try {
    return normalizeServerUrl(configured);
  } catch {
    return null;
  }
}

let runtimeServerUrl = developmentDefaultUrl();

/** 返回构建时提供的开发默认地址，不负责持久化。 */
export function getDevelopmentServerUrl(): string | null {
  return developmentDefaultUrl();
}

/** 更新当前进程内所有请求使用的服务器地址。 */
export function setRuntimeServerUrl(value: string | null): void {
  runtimeServerUrl = value ? normalizeServerUrl(value) : null;
}

/** 在实际发起请求时读取当前服务器地址。 */
export function getApiUrl(): string {
  if (!runtimeServerUrl) {
    throw new ServerUrlError('UNCONFIGURED', '尚未连接 EchoWave Server。');
  }
  return runtimeServerUrl;
}

/** 返回当前内存地址，供启动门禁和诊断 UI 使用。 */
export function peekApiUrl(): string | null {
  return runtimeServerUrl;
}
