/**
 * 音频模型执行 SSE 路由。
 *
 * 从持久化事件游标恢复并持续输出当前音频修订的模型执行轨迹。
 *
 * Responsibilities:
 * - 校验客户端游标并决定快照或增量恢复。
 * - 在通知或安全心跳后读取新的持久化事件。
 *
 * Notes:
 * - PostgreSQL 事件游标是恢复依据，LiveUpdateBroker 仅负责唤醒。
 */
import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

import type { LiveUpdateBroker } from '../../infrastructure/liveUpdateBroker.ts';
import type { AudioService } from '../../workspace/audio/core/service.ts';
import { entityId, errorBody } from '../response.ts';
import { prepareSse } from '../sse.ts';

/** 注册模型执行轨迹实时流。 */
export function registerAudioExecutionStreamRoute(
  app: Hono,
  service: AudioService,
  liveUpdates: LiveUpdateBroker,
): void {
  app.get('/api/audio-files/:audioFileId/analysis/executions/stream', async (context) => {
    const audioFileId = entityId(context.req.param('audioFileId'));
    const requestedGroupId = context.req.query('groupId');
    const groupId = requestedGroupId ? entityId(requestedGroupId) : undefined;
    const requestedCursor = context.req.query('cursor');
    if (
      requestedCursor &&
      (!/^(0|[1-9]\d{0,18})$/.test(requestedCursor) ||
        BigInt(requestedCursor) > 9_223_372_036_854_775_807n)
    ) {
      return context.json(errorBody('BAD_REQUEST', '请求参数无效。'), 400);
    }
    const subscription = liveUpdates.subscribe(
      (event) => event.kind === 'audio-execution' && event.audioFileId === audioFileId,
    );
    let snapshot;
    try {
      snapshot = await service.getAudioExecutionStreamSnapshot(audioFileId, groupId);
    } catch (error) {
      subscription.close();
      throw error;
    }
    prepareSse(context);
    return streamSSE(context, async (eventStream) => {
      const canResume =
        requestedCursor !== undefined && BigInt(requestedCursor) <= BigInt(snapshot.cursor);
      let cursor = canResume ? requestedCursor : snapshot.cursor;
      let lastHeartbeatAt = Date.now();
      if (!canResume) {
        await eventStream.writeSSE({
          id: snapshot.cursor,
          event: 'snapshot',
          data: JSON.stringify(snapshot),
        });
      }
      try {
        while (!eventStream.aborted) {
          const signal = await subscription.wait(15_000);
          try {
            const events = await service.getAudioExecutionStreamEvents(
              audioFileId,
              snapshot.analysisRevisionId,
              groupId,
              cursor,
            );
            for (const event of events) {
              cursor = event.cursor;
              await eventStream.writeSSE({
                id: event.cursor,
                event: event.type,
                data: JSON.stringify(event),
              });
            }
            if (!signal || Date.now() - lastHeartbeatAt >= 15_000) {
              lastHeartbeatAt = Date.now();
              await eventStream.writeSSE({
                id: cursor,
                event: 'heartbeat',
                data: JSON.stringify({
                  type: 'heartbeat',
                  cursor,
                  audioFileId,
                  analysisRevisionId: snapshot.analysisRevisionId,
                  occurredAt: new Date().toISOString(),
                }),
              });
            }
          } catch {
            await eventStream.writeSSE({
              id: cursor,
              event: 'error',
              data: JSON.stringify({
                type: 'error',
                cursor,
                audioFileId,
                analysisRevisionId: snapshot.analysisRevisionId,
                error: {
                  code: 'STREAM_UNAVAILABLE',
                  message: '模型执行实时流暂时不可用。',
                  retryable: true,
                },
              }),
            });
            break;
          }
        }
      } finally {
        subscription.close();
      }
    });
  });
}
