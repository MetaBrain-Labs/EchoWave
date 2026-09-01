/**
 * Credential 提交传输安全判定。
 *
 * 基于真实 TCP 对端、请求协议、Host 和显式可信代理 CIDR 判断是否允许明文 Secret 进入 API。
 *
 * Responsibilities:
 * - 仅信任来自配置代理网段的 X-Forwarded-Proto。
 * - 区分 HTTPS、真实 localhost 与远程明文 HTTP。
 *
 * Notes:
 * - 客户端上报的安全状态永远不是授权依据。
 */
import { getConnInfo } from '@hono/node-server/conninfo';
import type { TransportSecurityMode } from '@echowave/contracts';
import type { Context } from 'hono';
import { isIP } from 'node:net';

type ParsedAddress = { family: 4 | 6; value: bigint };

function parseIpv4(value: string): bigint | null {
  const octets = value.split('.');
  if (octets.length !== 4) return null;
  let result = 0n;
  for (const octet of octets) {
    if (!/^\d{1,3}$/.test(octet)) return null;
    const number = Number(octet);
    if (number > 255) return null;
    result = (result << 8n) | BigInt(number);
  }
  return result;
}

function ipv6Parts(value: string): number[] | null {
  const sections = value.split('::');
  if (sections.length > 2) return null;
  const parseSide = (side: string): number[] | null => {
    if (!side) return [];
    const output: number[] = [];
    for (const part of side.split(':')) {
      if (part.includes('.')) {
        const ipv4 = parseIpv4(part);
        if (ipv4 === null) return null;
        output.push(Number((ipv4 >> 16n) & 0xffffn), Number(ipv4 & 0xffffn));
      } else {
        if (!/^[0-9A-Fa-f]{1,4}$/.test(part)) return null;
        output.push(Number.parseInt(part, 16));
      }
    }
    return output;
  };
  const left = parseSide(sections[0] ?? '');
  const right = parseSide(sections[1] ?? '');
  if (!left || !right) return null;
  if (sections.length === 1) return left.length === 8 ? left : null;
  const missing = 8 - left.length - right.length;
  if (missing < 1) return null;
  return [...left, ...Array.from({ length: missing }, () => 0), ...right];
}

function parseAddress(raw: string): ParsedAddress | null {
  const normalized = raw.split('%')[0] ?? raw;
  if (normalized.toLowerCase().startsWith('::ffff:')) {
    const mapped = parseIpv4(normalized.slice(7));
    return mapped === null ? null : { family: 4, value: mapped };
  }
  if (isIP(normalized) === 4) {
    const value = parseIpv4(normalized);
    return value === null ? null : { family: 4, value };
  }
  if (isIP(normalized) === 6) {
    const parts = ipv6Parts(normalized);
    if (!parts) return null;
    return { family: 6, value: parts.reduce((result, part) => (result << 16n) | BigInt(part), 0n) };
  }
  return null;
}

function cidrContains(cidr: string, rawAddress: string): boolean {
  const [networkText, prefixText, ...rest] = cidr.split('/');
  if (!networkText || rest.length > 0) throw new Error(`Invalid trusted proxy CIDR: ${cidr}`);
  const network = parseAddress(networkText);
  const address = parseAddress(rawAddress);
  if (!network || !address || network.family !== address.family) return false;
  const bits = network.family === 4 ? 32 : 128;
  const prefix = prefixText === undefined ? bits : Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > bits) {
    throw new Error(`Invalid trusted proxy CIDR: ${cidr}`);
  }
  const shift = BigInt(bits - prefix);
  return network.value >> shift === address.value >> shift;
}

/** 判断一个真实对端地址是否属于显式可信代理列表。 */
export function isTrustedProxy(address: string, cidrs: string[]): boolean {
  return cidrs.some((cidr) => cidrContains(cidr, address));
}

function loopbackAddress(address: string): boolean {
  const parsed = parseAddress(address);
  if (!parsed) return false;
  return parsed.family === 4 ? parsed.value >> 24n === 127n : parsed.value === 1n;
}

/** 判断解析后的 IP 是否属于不得作为供应商出站目标的非公网地址。 */
export function isPrivateNetworkAddress(address: string): boolean {
  const parsed = parseAddress(address);
  if (!parsed) return false;
  if (parsed.family === 4) {
    const value = parsed.value;
    const first = Number((value >> 24n) & 0xffn);
    const second = Number((value >> 16n) & 0xffn);
    const third = Number((value >> 8n) & 0xffn);
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 192 && second === 0 && (third === 0 || third === 2)) ||
      (first === 192 && second === 88 && third === 99) ||
      (first === 198 && (second === 18 || second === 19)) ||
      (first === 198 && second === 51 && third === 100) ||
      (first === 203 && second === 0 && third === 113) ||
      first >= 224
    );
  }
  return (
    parsed.value === 0n ||
    parsed.value === 1n ||
    parsed.value >> 121n === 0x7en ||
    parsed.value >> 118n === 0x3fan ||
    parsed.value >> 96n === 0x20010db8n ||
    parsed.value >> 120n === 0xffn
  );
}

function loopbackHost(host: string): boolean {
  const normalized = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\](:\d+)?$/g, '');
  const withoutPort = normalized.startsWith('[') ? normalized : normalized.replace(/:\d+$/, '');
  return withoutPort === 'localhost' || loopbackAddress(withoutPort);
}

export type TransportSecurity = {
  mode: TransportSecurityMode;
  secretSubmissionAllowed: boolean;
  warning: string | null;
};

/** 使用已提取的连接事实执行可独立测试的安全分类。 */
export function classifyTransport(input: {
  protocol: string;
  host: string;
  remoteAddress: string;
  forwardedProto?: string;
  trustedProxyCidrs: string[];
}): TransportSecurity {
  if (input.protocol.toLowerCase() === 'https:') {
    return { mode: 'https', secretSubmissionAllowed: true, warning: null };
  }
  if (
    isTrustedProxy(input.remoteAddress, input.trustedProxyCidrs) &&
    input.forwardedProto?.trim().toLowerCase() === 'https'
  ) {
    return { mode: 'trusted_proxy_https', secretSubmissionAllowed: true, warning: null };
  }
  if (loopbackAddress(input.remoteAddress) && loopbackHost(input.host)) {
    return { mode: 'localhost', secretSubmissionAllowed: true, warning: null };
  }
  return {
    mode: 'insecure_remote_http',
    secretSubmissionAllowed: false,
    warning:
      '当前连接不是 HTTPS，不能通过此页面提交 Credential。请在服务器本地配置 credentials.yaml，然后选择对应的 Local Credential alias。',
  };
}

/** 从 Hono Node 请求提取真实连接信息并返回服务端权威安全状态。 */
export function transportSecurityFromContext(
  context: Context,
  trustedProxyCidrs: string[],
): TransportSecurity {
  let remoteAddress = '';
  try {
    remoteAddress = getConnInfo(context).remote.address ?? '';
  } catch {
    // 测试适配器没有 Node socket；空地址必须按远程不安全连接处理。
  }
  const url = new URL(context.req.url);
  return classifyTransport({
    protocol: url.protocol,
    host: context.req.header('host') ?? url.host,
    remoteAddress,
    forwardedProto: context.req.header('x-forwarded-proto'),
    trustedProxyCidrs,
  });
}
