/**
 * DashScope 转写临时 OSS 中转。
 *
 * 将权威本地音频的单次修订副本上传到北京地域 OSS，并生成短期只读 URL。
 *
 * Responsibilities:
 * - 使用不可预测且租户隔离的对象键上传整段音频。
 * - 生成 24 小时签名 URL，并在任务终止后尽力清理对象。
 *
 * Notes:
 * - OSS 仅是供应商中转层，不承担 EchoWave 音频持久化职责。
 */
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import OSS from 'ali-oss';

const SIGNED_URL_SECONDS = 24 * 60 * 60;

export type OssStagingConfig = {
  region: string;
  bucket: string;
  accessKeyId: string;
  accessKeySecret: string;
  tenantId: string;
};

export type OssStagingClient = Pick<OSS, 'put' | 'delete' | 'signatureUrl'>;

/** 管理 DashScope 单次修订对应的临时 OSS 对象。 */
export class OssStagingStore {
  private readonly client: OssStagingClient;

  constructor(
    private readonly config: OssStagingConfig,
    client?: OssStagingClient,
  ) {
    this.client =
      client ??
      new OSS({
        region: config.region,
        bucket: config.bucket,
        accessKeyId: config.accessKeyId,
        accessKeySecret: config.accessKeySecret,
        secure: true,
      });
  }

  /** 上传整文件并返回仅包含服务端定位信息的随机对象键。 */
  async upload(revisionId: string, filePath: string): Promise<string> {
    const extension = path.extname(filePath).toLowerCase() || '.mp3';
    const objectKey = `echowave/asr-staging/${this.config.tenantId}/${revisionId}/${randomUUID()}${extension}`;
    await this.client.put(objectKey, filePath);
    return objectKey;
  }

  /** 上传后置情绪分析窗口，使用独立前缀便于生命周期审计和清理。 */
  async uploadEmotionWindow(jobId: string, filePath: string): Promise<string> {
    const extension = path.extname(filePath).toLowerCase() || '.mp3';
    const objectKey = `echowave/emotion-staging/${this.config.tenantId}/${jobId}/${randomUUID()}${extension}`;
    await this.client.put(objectKey, filePath);
    return objectKey;
  }

  /** 为已上传对象生成 24 小时 GET 签名地址。 */
  signedGetUrl(objectKey: string): string {
    return this.client.signatureUrl(objectKey, {
      expires: SIGNED_URL_SECONDS,
      method: 'GET',
    });
  }

  /** 尽力删除终态任务对应的临时对象；调用方决定如何记录清理错误。 */
  async delete(objectKey: string): Promise<void> {
    await this.client.delete(objectKey);
  }
}
