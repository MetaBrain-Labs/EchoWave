/**
 * 音频模型临时产物存储端口。
 *
 * 统一企业 OSS 与 DashScope Instant 的最小行为，使 Worker 不感知具体上传凭据来源。
 *
 * Responsibilities:
 * - 上传 ASR 整文件和情绪窗口。
 * - 解析模型可读取的短期地址并执行尽力清理。
 */
export interface AudioArtifactStore {
  upload(revisionId: string, filePath: string): Promise<string>;
  uploadEmotionWindow(jobId: string, filePath: string): Promise<string>;
  signedGetUrl(key: string): string;
  delete(key: string): Promise<void>;
}
