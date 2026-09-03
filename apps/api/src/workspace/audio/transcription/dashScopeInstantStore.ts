/**
 * DashScope Instant 临时文件区适配器。
 *
 * 使用模型账号自身的临时上传策略提交 ASR 文件与声学窗口，避免轻量本地用户配置企业 OSS。
 *
 * Responsibilities:
 * - 获取五分钟上传凭证并以 multipart 流式上传单个文件。
 * - 返回仅能由同账号同模型解析、48 小时有效的 oss:// 地址。
 *
 * Notes:
 * - 临时区由 DashScope 自动过期，delete 为幂等空操作。
 */
import { openAsBlob } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { z } from 'zod';

const PolicySchema = z.object({
  data: z.object({
    policy: z.string().min(1),
    signature: z.string().min(1),
    upload_dir: z.string().min(1),
    upload_host: z.string().url(),
    oss_access_key_id: z.string().min(1),
    x_oss_object_acl: z.string().min(1),
    x_oss_forbid_overwrite: z.string().min(1),
  }),
});

/** 为一个固定 DashScope 模型上传短期音频资源。 */
export class DashScopeInstantStore {
  constructor(
    private readonly options: {
      apiKey: string;
      baseUrl: string;
      model: string;
      fetch?: typeof fetch;
    },
  ) {}

  async upload(revisionId: string, filePath: string): Promise<string> {
    return this.uploadFile(`asr-${revisionId}`, filePath);
  }

  async uploadEmotionWindow(jobId: string, filePath: string): Promise<string> {
    return this.uploadFile(`emotion-${jobId}`, filePath);
  }

  signedGetUrl(key: string): string {
    if (!key.startsWith('oss://')) throw new Error('DashScope instant resource is unavailable.');
    return key;
  }

  async delete(_key: string): Promise<void> {}

  private async uploadFile(scope: string, filePath: string): Promise<string> {
    const request = this.options.fetch ?? fetch;
    const policyResponse = await request(
      `${this.options.baseUrl.replace(/\/$/, '')}/uploads?action=getPolicy&model=${encodeURIComponent(this.options.model)}`,
      {
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          'Content-Type': 'application/json',
        },
      },
    );
    if (!policyResponse.ok) throw new Error(`dashscope-upload-policy-${policyResponse.status}`);
    const policy = PolicySchema.parse(await policyResponse.json()).data;
    const filename = `${scope}-${randomUUID()}${path.extname(filePath).toLowerCase() || '.mp3'}`;
    const key = `${policy.upload_dir}/${filename}`;
    const form = new FormData();
    form.append('OSSAccessKeyId', policy.oss_access_key_id);
    form.append('policy', policy.policy);
    form.append('Signature', policy.signature);
    form.append('key', key);
    form.append('x-oss-object-acl', policy.x_oss_object_acl);
    form.append('x-oss-forbid-overwrite', policy.x_oss_forbid_overwrite);
    form.append('success_action_status', '200');
    form.append('file', await openAsBlob(filePath), filename);
    const upload = await request(policy.upload_host, { method: 'POST', body: form });
    if (!upload.ok) throw new Error(`dashscope-instant-upload-${upload.status}`);
    return `oss://${key}`;
  }
}
