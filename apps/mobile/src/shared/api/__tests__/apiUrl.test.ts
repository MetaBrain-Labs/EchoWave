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
import { resolveApiUrl } from '../apiUrl';

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
