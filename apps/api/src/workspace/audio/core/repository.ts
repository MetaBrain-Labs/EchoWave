/**
 * 音频核心持久化端口。
 *
 * 定义播放、分析详情和分组访问校验所需的最小 SQL 能力。
 *
 * Responsibilities:
 * - 隔离 AudioService 与工作区目录实现。
 * - 保持音频访问校验由持久层执行。
 *
 * Notes:
 * - 转写及各分析任务继续使用自己的生命周期 Repository。
 */
import type { AudioAnalysisDetail } from '@echowave/contracts';

/** 文件播放服务需要的租户内存储元数据。 */
export type AudioPlaybackSource = {
  mimeType: string;
  originalFilename: string;
  storageKey: string;
};

/** 音频核心读取 Repository 端口。 */
export interface AudioCoreRepository {
  getAudioPlaybackSource(id: string): Promise<AudioPlaybackSource>;
  getAudioAnalysis(id: string): Promise<AudioAnalysisDetail>;
  resolveSpeakerReviewFinding(audioFileId: string, findingId: string): Promise<number>;
  resolveAllSpeakerReviewFindings(audioFileId: string): Promise<number>;
  assertGroupAudioAccess(groupId: string, audioFileId: string): Promise<void>;
}
