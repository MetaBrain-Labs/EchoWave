/**
 * 移动端 API 地址解析测试。
 *
 * 锁定 Web loopback 开发页和远程访问对 API 主机的选择规则。
 *
 * Responsibilities:
 * - 验证 localhost 页面会把局域网 HTTP API 地址改为真实 loopback 请求。
 * - 验证远程页面、原生运行时与 HTTPS 显式配置不会被改写。
 *
 * Notes:
 * - 只测试纯地址解析，不发起网络请求。
 */
import { audioPlaybackUrl, resolveApiUrl } from '../apiUrl';
import {
  getApiUrl,
  getDevelopmentServerUrl,
  isLocalServerHost,
  normalizeServerUrl,
  ServerUrlError,
  setRuntimeServerUrl,
} from '../serverUrl';

describe('resolveApiUrl', () => {
  it('uses the browser loopback host for an HTTP API configured with a LAN address', () => {
    expect(resolveApiUrl('http://192.168.1.7:3201', 'localhost')).toBe('http://localhost:3201');
    expect(resolveApiUrl('http://192.168.1.7:3201/', '127.0.0.1')).toBe('http://127.0.0.1:3201');
  });

  it('preserves the configured address outside a loopback HTTP web page', () => {
    expect(resolveApiUrl('http://192.168.1.7:3201', '192.168.1.7')).toBe('http://192.168.1.7:3201');
    expect(resolveApiUrl('http://192.168.1.7:3201', undefined)).toBe('http://192.168.1.7:3201');
    expect(resolveApiUrl('https://api.example.com', 'localhost')).toBe('https://api.example.com');
  });
});

describe('runtime server URL', () => {
  const originalDevelopmentUrl = process.env.EXPO_PUBLIC_API_URL;

  afterEach(() => {
    delete process.env.EXPO_PUBLIC_REQUIRE_SERVER_SELECTION;
    if (originalDevelopmentUrl === undefined) delete process.env.EXPO_PUBLIC_API_URL;
    else process.env.EXPO_PUBLIC_API_URL = originalDevelopmentUrl;
    setRuntimeServerUrl('http://localhost:3001');
  });

  it('normalizes supported local HTTP and public HTTPS roots', () => {
    expect(normalizeServerUrl(' http://192.168.1.7:3001/ ')).toBe('http://192.168.1.7:3001');
    expect(normalizeServerUrl('https://api.example.com/')).toBe('https://api.example.com');
    expect(isLocalServerHost('echo-server.local')).toBe(true);
    expect(isLocalServerHost('100.64.0.10')).toBe(true);
  });

  it('rejects unsafe protocols, embedded credentials, paths, and public HTTP', () => {
    for (const value of [
      'ftp://192.168.1.7',
      'http://user:pass@192.168.1.7',
      'http://192.168.1.7/api',
      'http://192.168.1.7?mode=test',
      'http://api.example.com',
    ]) {
      expect(() => normalizeServerUrl(value)).toThrow(ServerUrlError);
    }
  });

  it('reads the current address at request time', () => {
    setRuntimeServerUrl('http://192.168.1.7:3001');
    expect(getApiUrl()).toBe('http://192.168.1.7:3001');
    expect(audioPlaybackUrl('audio/id')).toContain('/api/audio-files/audio%2Fid/content');
    setRuntimeServerUrl('https://api.example.com');
    expect(getApiUrl()).toBe('https://api.example.com');
    expect(audioPlaybackUrl('audio/id')).toBe(
      'https://api.example.com/api/audio-files/audio%2Fid/content',
    );
  });

  it('ignores a development default when a production build requires manual selection', () => {
    process.env.EXPO_PUBLIC_API_URL = 'http://192.168.1.7:3001';
    process.env.EXPO_PUBLIC_REQUIRE_SERVER_SELECTION = 'true';
    expect(getDevelopmentServerUrl()).toBeNull();
  });
});
