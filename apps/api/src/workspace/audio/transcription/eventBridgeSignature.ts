/**
 * EventBridge HTTP 回调签名校验。
 *
 * 按阿里云 EventBridge 规范使用原始请求正文、精确目标 URL 与固定顺序请求头构造待签串，
 * 并限制证书只能来自北京地域官方地址。
 *
 * Responsibilities:
 * - 拒绝过期、Token 不匹配或签名无效的回调。
 * - 安全下载、解析并短期缓存 EventBridge 公钥证书。
 *
 * Notes:
 * - 回调 URL 使用配置值而不是代理重写后的请求 URL，保证待签串稳定。
 */
import {
  X509Certificate,
  timingSafeEqual,
  verify as verifySignature,
  type KeyObject,
} from 'node:crypto';

const MAX_CLOCK_SKEW_MS = 60_000;
const CERTIFICATE_CACHE_MS = 60 * 60 * 1_000;
const MAX_CERTIFICATE_BYTES = 64 * 1_024;
const CERTIFICATE_HOST = 'cn-beijing-eventbridge.oss-accelerate.aliyuncs.com';

type PublicKeyLoader = (certificateUrl: string) => Promise<KeyObject>;

/** EventBridge 回调鉴权失败或证书服务暂不可用。 */
export class EventBridgeSignatureError extends Error {
  constructor(
    public readonly kind: 'unauthorized' | 'temporary_unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'EventBridgeSignatureError';
  }
}

/** 校验 EventBridge HTTP 目标请求的 RSA-SHA256 签名。 */
export class EventBridgeSignatureVerifier {
  private readonly certificateCache = new Map<
    string,
    { expiresAt: number; publicKey: KeyObject }
  >();

  constructor(
    private readonly options: {
      callbackUrl: string;
      token: string;
      fetchImpl?: typeof fetch;
      now?: () => number;
      publicKeyLoader?: PublicKeyLoader;
    },
  ) {}

  /** 在解析 JSON 前校验原始正文和全部固定签名头。 */
  async verify(rawBody: string, headers: Headers): Promise<void> {
    const timestamp = this.requiredHeader(headers, 'x-eventbridge-signature-timestamp');
    const hashMethod = this.requiredHeader(headers, 'x-eventbridge-hash-method');
    const version = this.requiredHeader(headers, 'x-eventbridge-signature-version');
    const certificateUrl = this.requiredHeader(headers, 'x-eventbridge-signature-url');
    const token = this.requiredHeader(headers, 'x-eventbridge-signature-token');
    const signature = this.requiredHeader(headers, 'x-eventbridge-signature-v2');

    const timestampMs = Number(timestamp);
    const now = (this.options.now ?? Date.now)();
    if (!Number.isFinite(timestampMs) || Math.abs(now - timestampMs) > MAX_CLOCK_SKEW_MS) {
      throw new EventBridgeSignatureError(
        'unauthorized',
        'EventBridge callback timestamp expired.',
      );
    }
    if (hashMethod !== 'SHA256' || version !== '1.0') {
      throw new EventBridgeSignatureError(
        'unauthorized',
        'Unsupported EventBridge signature metadata.',
      );
    }
    if (!safeEqual(token, this.options.token)) {
      throw new EventBridgeSignatureError('unauthorized', 'EventBridge callback token mismatch.');
    }
    validateCertificateUrl(certificateUrl);

    const fixedHeaders = [
      `x-eventbridge-signature-timestamp: ${timestamp}`,
      `x-eventbridge-hash-method: ${hashMethod}`,
      `x-eventbridge-signature-version: ${version}`,
      `x-eventbridge-signature-url: ${certificateUrl}`,
      `x-eventbridge-signature-token: ${token}`,
    ].join('\n');
    const stringToSign = `${this.options.callbackUrl}\n${fixedHeaders}\n${rawBody}`;
    let signatureBytes: Buffer;
    try {
      signatureBytes = Buffer.from(signature, 'base64');
    } catch {
      throw new EventBridgeSignatureError(
        'unauthorized',
        'Invalid EventBridge signature encoding.',
      );
    }
    const publicKey = await this.loadPublicKey(certificateUrl);
    if (
      !verifySignature('RSA-SHA256', Buffer.from(stringToSign, 'utf8'), publicKey, signatureBytes)
    ) {
      throw new EventBridgeSignatureError(
        'unauthorized',
        'EventBridge callback signature invalid.',
      );
    }
  }

  private requiredHeader(headers: Headers, name: string): string {
    const value = headers.get(name)?.trim();
    if (!value) throw new EventBridgeSignatureError('unauthorized', `Missing ${name} header.`);
    return value;
  }

  private async loadPublicKey(certificateUrl: string): Promise<KeyObject> {
    const now = (this.options.now ?? Date.now)();
    const cached = this.certificateCache.get(certificateUrl);
    if (cached && cached.expiresAt > now) return cached.publicKey;

    if (this.options.publicKeyLoader) {
      const publicKey = await this.options.publicKeyLoader(certificateUrl);
      this.certificateCache.set(certificateUrl, {
        expiresAt: now + CERTIFICATE_CACHE_MS,
        publicKey,
      });
      return publicKey;
    }

    const fetchImpl = this.options.fetchImpl ?? fetch;
    let response: Response;
    try {
      response = await fetchImpl(certificateUrl, {
        redirect: 'error',
        signal: AbortSignal.timeout(3_000),
      });
    } catch {
      throw new EventBridgeSignatureError(
        'temporary_unavailable',
        'EventBridge certificate download failed.',
      );
    }
    if (!response.ok) {
      throw new EventBridgeSignatureError(
        'temporary_unavailable',
        'EventBridge certificate endpoint unavailable.',
      );
    }
    const declaredLength = Number(response.headers.get('content-length') ?? 0);
    if (declaredLength > MAX_CERTIFICATE_BYTES) {
      throw new EventBridgeSignatureError('unauthorized', 'EventBridge certificate is too large.');
    }
    const bytes = await readLimitedCertificate(response);
    if (bytes.length === 0 || bytes.length > MAX_CERTIFICATE_BYTES) {
      throw new EventBridgeSignatureError('unauthorized', 'EventBridge certificate is invalid.');
    }
    let publicKey: KeyObject;
    try {
      publicKey = new X509Certificate(bytes).publicKey;
    } catch {
      throw new EventBridgeSignatureError('unauthorized', 'EventBridge certificate is invalid.');
    }
    this.certificateCache.set(certificateUrl, {
      expiresAt: now + CERTIFICATE_CACHE_MS,
      publicKey,
    });
    return publicKey;
  }
}

async function readLimitedCertificate(response: Response): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_CERTIFICATE_BYTES) {
        void reader.cancel();
        throw new EventBridgeSignatureError(
          'unauthorized',
          'EventBridge certificate is too large.',
        );
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    if (error instanceof EventBridgeSignatureError) throw error;
    throw new EventBridgeSignatureError(
      'temporary_unavailable',
      'EventBridge certificate download failed.',
    );
  }
  return Buffer.concat(chunks, totalBytes);
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function validateCertificateUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new EventBridgeSignatureError('unauthorized', 'Invalid EventBridge certificate URL.');
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== CERTIFICATE_HOST ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new EventBridgeSignatureError('unauthorized', 'Untrusted EventBridge certificate URL.');
  }
}
