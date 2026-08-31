/**
 * 音频执行查询端口。
 *
 * 定义 AudioService 读取轨迹与 SSE 增量所需的最小能力。
 *
 * Responsibilities:
 * - 隔离音频核心 Service 与 PostgreSQL 实现。
 *
 * Notes:
 * - 报告器创建属于具体 runtime 装配能力，不进入本查询端口。
 */
import type {
  AudioAiExecutionStreamEvent,
  AudioAiExecutionTraceResponse,
} from '@echowave/contracts';

/** 音频执行轨迹只读端口。 */
export interface AudioExecutionQuery {
  getTrace(
    audioFileId: string,
    revisionId: string,
    groupId?: string,
  ): Promise<AudioAiExecutionTraceResponse>;
  getStreamSnapshot(
    audioFileId: string,
    revisionId: string,
    groupId?: string,
  ): Promise<AudioAiExecutionStreamEvent>;
  getStreamEvents(
    audioFileId: string,
    revisionId: string,
    groupId: string | undefined,
    cursor: string,
  ): Promise<AudioAiExecutionStreamEvent[]>;
}
