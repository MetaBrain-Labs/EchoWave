/**
 * 数据源页面展示模型。
 *
 * 将共享网络契约转换为现有数据源页面需要的中文时间线和状态结构。
 *
 * Responsibilities:
 * - 格式化时长、日期和上传记录说明。
 * - 保持服务端事实字段与页面文案解耦。
 *
 * Notes:
 * - 本文件不包含演示数据或持久化行为。
 */
import type {
  AudioFailureDetails,
  AudioFileSummary,
  AudioTranscriptionActivity,
  DataSourceDetail as DataSourceContract,
  DataSourceIngestionRecord,
  LinkedDataSourceGroup,
} from '@echowave/contracts';

export type SourceAudioStatus =
  | { kind: 'complete' }
  | { kind: 'uploading' }
  | { kind: 'transcribing'; progress: number; activity: AudioTranscriptionActivity | null }
  | { kind: 'waiting' }
  | {
      kind: 'upload-failed';
      code: string;
      message: string;
      retryable: boolean;
      details: AudioFailureDetails | null;
    }
  | {
      kind: 'transcription-failed';
      code: string;
      message: string;
      retryable: boolean;
      details: AudioFailureDetails | null;
    };

export type SourceAudioItem = {
  id: string;
  title: string;
  duration: string;
  createdAt: string;
  hasTranscript: boolean;
  status: SourceAudioStatus;
};

export type UploadRecord = {
  id: string;
  date: string;
  time: string;
  kind: 'upload-success' | 'upload-failed' | 'transcription-failed';
  description: string;
  detail: string;
};

export type DataSourceDetailView = {
  id: string;
  name: string;
  description: string;
  connection: string;
  location: 'local' | 'cloud';
  linkedGroupCount: number;
  uploadedAt: string;
  analysisModel: string;
  autoTranscribe: boolean;
  emotionAnalysis: boolean;
  roleSeparation: boolean;
  sceneSeparation: boolean;
  skipInvalidAudio: boolean;
  audioItems: SourceAudioItem[];
  uploadRecords: UploadRecord[];
  linkedGroups: LinkedDataSourceGroup[];
  totalDuration: string;
};

/** 将毫秒格式化为页面使用的紧凑时长。 */
export function formatDuration(durationMs: number) {
  const totalSeconds = Math.floor(durationMs / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

function sourceAudioStatus(audio: AudioFileSummary): SourceAudioStatus {
  switch (audio.status.kind) {
    case 'ready':
      return { kind: 'complete' };
    case 'uploading':
      return { kind: 'uploading' };
    case 'waiting':
      return { kind: 'waiting' };
    case 'transcribing':
      return {
        kind: 'transcribing',
        progress: audio.status.progress,
        activity: audio.status.activity,
      };
    case 'analyzing':
      return { kind: 'transcribing', progress: audio.status.progress, activity: null };
    case 'failed':
      return audio.status.stage === 'upload'
        ? {
            kind: 'upload-failed',
            code: audio.status.code,
            message: audio.status.message,
            retryable: audio.status.retryable,
            details: audio.status.details,
          }
        : {
            kind: 'transcription-failed',
            code: audio.status.code,
            message: audio.status.message,
            retryable: audio.status.retryable,
            details: audio.status.details,
          };
  }
}

/** 将服务端数据源详情及其子资源转换为单页展示模型。 */
export function toDataSourceDetailView(
  detail: DataSourceContract,
  audioItems: AudioFileSummary[],
  records: DataSourceIngestionRecord[],
  groups: LinkedDataSourceGroup[],
): DataSourceDetailView {
  return {
    id: detail.id,
    name: detail.name,
    description: detail.description,
    connection: detail.connectionLabel,
    location: detail.location,
    linkedGroupCount: detail.linkedGroupCount,
    uploadedAt: detail.lastUploadedAt ? new Date(detail.lastUploadedAt).toLocaleString() : '暂无',
    analysisModel: detail.settings.transcriptionModel,
    autoTranscribe: detail.settings.autoTranscribe,
    emotionAnalysis: detail.settings.emotionAnalysis,
    roleSeparation: detail.settings.speakerDiarization,
    sceneSeparation: detail.settings.sceneSegmentation,
    skipInvalidAudio: detail.settings.skipInvalidAudio,
    totalDuration: formatDuration(detail.metrics.totalDurationMs),
    audioItems: audioItems.map((audio) => ({
      id: audio.id,
      title: audio.title,
      duration: audio.durationMs === null ? '--:--' : formatDuration(audio.durationMs),
      createdAt: new Date(audio.createdAt).toLocaleDateString(),
      hasTranscript: audio.hasTranscript,
      status: sourceAudioStatus(audio),
    })),
    uploadRecords: records.map((record) => {
      const occurredAt = new Date(record.occurredAt);
      const failed = record.kind !== 'upload-success';
      return {
        id: record.id,
        date: occurredAt.toLocaleDateString(),
        time: occurredAt.toLocaleTimeString([], { hour12: false }),
        kind: record.kind,
        description: failed
          ? (record.errorMessage ?? '处理失败')
          : `收到 ${record.audioCount} 条音频，共 ${formatDuration(record.totalDurationMs)}`,
        detail: failed
          ? record.retryable
            ? '可以重试'
            : '请检查音频或来源配置'
          : '已按数据源设置继续处理',
      };
    }),
    linkedGroups: groups,
  };
}
