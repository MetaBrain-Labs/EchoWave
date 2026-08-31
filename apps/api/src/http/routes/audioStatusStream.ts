/**
 * 音频分析状态 SSE 路由。
 *
 * 维护当前分析修订的后处理与业务分析状态快照和增量刷新。
 *
 * Responsibilities:
 * - 订阅匹配音频和分组的状态失效事件。
 * - 输出契约化快照、状态更新、心跳与失败事件。
 *
 * Notes:
 * - 每次失效后重新读取 PostgreSQL 权威快照。
 */
import {
  AudioAnalysisStatusStreamEventSchema,
  AudioBusinessAnalysisLiveStateSchema,
  type AudioAnalysisDetail,
} from '@echowave/contracts';
import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

import type { LiveUpdateBroker } from '../../infrastructure/liveUpdateBroker.ts';
import type { AudioService } from '../../workspace/audio/core/service.ts';
import { entityId } from '../response.ts';
import { nextLiveCursor, occurredAt, prepareSse, writeJsonSse } from '../sse.ts';

function analysisLiveState(detail: AudioAnalysisDetail) {
  return {
    emotion: detail.postAnalysis.emotion,
    role: detail.postAnalysis.role,
    business: AudioBusinessAnalysisLiveStateSchema.parse(detail.businessAnalysis),
  };
}

/** 注册音频分析状态实时流。 */
export function registerAudioStatusStreamRoute(
  app: Hono,
  service: AudioService,
  liveUpdates: LiveUpdateBroker,
): void {
  app.get('/api/audio-files/:audioFileId/analysis/status/stream', async (context) => {
    const audioFileId = entityId(context.req.param('audioFileId'));
    const requestedGroupId = context.req.query('groupId');
    const groupId = requestedGroupId ? entityId(requestedGroupId) : undefined;
    const subscription = liveUpdates.subscribe(
      (event) =>
        event.kind === 'audio-analysis' &&
        event.audioFileId === audioFileId &&
        (event.groupId === null || event.groupId === (groupId ?? null)),
    );
    let snapshot;
    try {
      snapshot = await service.getAudioAnalysis(audioFileId, groupId);
    } catch (error) {
      subscription.close();
      throw error;
    }
    prepareSse(context);
    return streamSSE(context, async (eventStream) => {
      try {
        const initial = AudioAnalysisStatusStreamEventSchema.parse({
          type: 'snapshot',
          cursor: nextLiveCursor(),
          occurredAt: occurredAt(),
          audioFileId,
          analysisRevisionId: snapshot.id,
          state: analysisLiveState(snapshot),
        });
        await writeJsonSse(eventStream, initial);
        while (!eventStream.aborted) {
          const signal = await subscription.wait(15_000);
          if (!signal) {
            const heartbeat = AudioAnalysisStatusStreamEventSchema.parse({
              type: 'heartbeat',
              cursor: nextLiveCursor(),
              occurredAt: occurredAt(),
            });
            await writeJsonSse(eventStream, heartbeat);
            continue;
          }
          if (signal.kind !== 'audio-analysis') continue;
          const detail = await service.getAudioAnalysis(audioFileId, groupId);
          const update = AudioAnalysisStatusStreamEventSchema.parse({
            type: 'analysis-status',
            cursor: nextLiveCursor(),
            occurredAt: occurredAt(),
            audioFileId,
            analysisRevisionId: detail.id,
            state: analysisLiveState(detail),
            terminal: signal.terminal,
          });
          await writeJsonSse(eventStream, update);
        }
      } catch {
        if (!eventStream.aborted) {
          const failure = AudioAnalysisStatusStreamEventSchema.parse({
            type: 'error',
            cursor: nextLiveCursor(),
            occurredAt: occurredAt(),
            error: {
              code: 'STREAM_UNAVAILABLE',
              message: '分析实时状态暂时不可用。',
              retryable: true,
            },
          });
          await writeJsonSse(eventStream, failure);
        }
      } finally {
        subscription.close();
      }
    });
  });
}
