/**
 * 权威音频对象存储适配器。
 *
 * 为对象存储模式生成直传地址，并以短期只读地址把源音频流式物化到 Worker 临时目录。
 *
 * Responsibilities:
 * - 生成租户隔离且不可预测的对象键。
 * - 提供 PUT、GET、Range 和元数据能力而不暴露 Credential。
 *
 * Notes:
 * - 本适配器不决定对象生命周期，删除时机由运行模式清理任务管理。
 */
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import OSS from 'ali-oss';

const SIGNED_URL_SECONDS = 60 * 60;

type PrimaryOssClient = Pick<OSS, 'delete' | 'head' | 'signatureUrl'>;

/** 封装一个固定配置 revision 对应的企业 OSS。 */
export class PrimaryOssStore {
  private readonly client: PrimaryOssClient;

  constructor(
    private readonly config: {
      accessKeyId: string;
      accessKeySecret: string;
      bucket: string;
      region: string;
      tenantId: string;
    },
    client?: PrimaryOssClient,
  ) {
    this.client =
      client ??
      new OSS({
        accessKeyId: config.accessKeyId,
        accessKeySecret: config.accessKeySecret,
        bucket: config.bucket,
        region: config.region,
        secure: true,
      });
  }

  /** 创建原音频对象键，扩展名只来自已经净化的文件名。 */
  createSourceKey(filename: string): string {
    const extension = path.extname(path.basename(filename)).toLowerCase();
    return `echowave/audio-source/${this.config.tenantId}/${randomUUID()}${extension}`;
  }

  /** 为 APP 生成一小时有效的直接上传 URL。 */
  signedPutUrl(objectKey: string, mimeType: string): string {
    return this.client.signatureUrl(objectKey, {
      expires: SIGNED_URL_SECONDS,
      method: 'PUT',
      'Content-Type': mimeType,
    });
  }

  /** 为服务端 Worker 生成短期读取 URL。 */
  signedGetUrl(objectKey: string): string {
    return this.client.signatureUrl(objectKey, {
      expires: SIGNED_URL_SECONDS,
      method: 'GET',
    });
  }

  /** 校验直传对象存在并返回实际字节数。 */
  async size(objectKey: string): Promise<number> {
    const result = await this.client.head(objectKey);
    const headers = result.res.headers as Record<string, string | number | undefined>;
    const value = Number(headers['content-length']);
    if (!Number.isFinite(value) || value < 0) throw new Error('Object size is unavailable.');
    return value;
  }

  /** 删除已到期或补偿清理的原音频。 */
  async delete(objectKey: string): Promise<void> {
    await this.client.delete(objectKey);
  }

  /** 把源对象流式写入任务临时目录，返回路径和幂等清理函数。 */
  async materialize(
    objectKey: string,
    directory: string,
    filename: string,
  ): Promise<{ path: string; cleanup: () => Promise<void> }> {
    await mkdir(directory, { recursive: true });
    const target = path.resolve(directory, path.basename(filename));
    const response = await fetch(this.signedGetUrl(objectKey));
    if (!response.ok || !response.body) throw new Error(`object-download-${response.status}`);
    await pipeline(
      Readable.from(response.body as unknown as AsyncIterable<Uint8Array>),
      createWriteStream(target, { mode: 0o600 }),
    );
    return {
      path: target,
      cleanup: () => rm(directory, { force: true, recursive: true }),
    };
  }
}
