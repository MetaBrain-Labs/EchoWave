/**
 * 音频 HTTP 路由。
 *
 * 管理分析读取、模型执行轨迹、播放内容、转写确认及各类分析启动请求。
 *
 * Responsibilities:
 * - 校验音频相关路径、查询和 JSON 输入。
 * - 以 Range/HEAD 语义安全传输本地音频内容。
 * - 组合音频状态和执行轨迹实时路由。
 *
 * Notes:
 * - 转写与分析工作流由领域服务和 worker 执行。
 */
import {
  AudioBusinessAnalysisStartRequestSchema,
  SpeakerReviewResolutionResponseSchema,
  AudioTranscriptConfirmationRequestSchema,
  AudioTranscriptionStartRequestSchema,
  AudioTranscriptSelectionRequestSchema,
} from '@echowave/contracts';
import type { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { createReadStream } from 'node:fs';

import type { LiveUpdateBroker } from '../../infrastructure/liveUpdateBroker.ts';
import type { AudioService } from '../../workspace/audio/core/service.ts';
import { resolveAudioByteRange } from '../audioContent.ts';
import { entityId } from '../response.ts';
import { registerAudioExecutionStreamRoute } from './audioExecutionStream.ts';
import { registerAudioStatusStreamRoute } from './audioStatusStream.ts';

/** 注册音频播放、转写与分析路由。 */
export function registerAudioRoutes(
  app: Hono,
  service: AudioService,
  liveUpdates: LiveUpdateBroker,
): void {
  app.get('/api/audio-files/:audioFileId/analysis', async (context) => {
    const requestedGroupId = context.req.query('groupId');
    return context.json(
      await service.getAudioAnalysis(
        entityId(context.req.param('audioFileId')),
        requestedGroupId ? entityId(requestedGroupId) : undefined,
      ),
    );
  });
  registerAudioStatusStreamRoute(app, service, liveUpdates);

  app.get('/api/audio-files/:audioFileId/analysis/executions', async (context) => {
    const requestedGroupId = context.req.query('groupId');
    return context.json(
      await service.getAudioExecutionTrace(
        entityId(context.req.param('audioFileId')),
        requestedGroupId ? entityId(requestedGroupId) : undefined,
      ),
    );
  });
  registerAudioExecutionStreamRoute(app, service, liveUpdates);

  app.post('/api/audio-files/:audioFileId/business-analyses', async (context) => {
    const input = AudioBusinessAnalysisStartRequestSchema.parse(await context.req.json());
    return context.json(
      await service.startAudioBusinessAnalysis(entityId(context.req.param('audioFileId')), input),
      202,
    );
  });
  app.on(['GET', 'HEAD'], '/api/audio-files/:audioFileId/content', async (context) => {
    const file = await service.getAudioPlaybackFile(entityId(context.req.param('audioFileId')));
    const range = resolveAudioByteRange(context.req.header('range'), file.sizeBytes);
    context.header('Accept-Ranges', 'bytes');
    context.header('Cache-Control', 'private, no-store');
    context.header('Content-Type', file.mimeType);
    context.header('Last-Modified', file.lastModified.toUTCString());
    context.header(
      'Content-Disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(file.originalFilename)}`,
    );
    if (range.kind === 'unsatisfiable') {
      context.header('Content-Range', `bytes */${file.sizeBytes}`);
      return context.body(null, 416);
    }

    const contentLength = range.end - range.start + 1;
    context.header('Content-Length', String(contentLength));
    if (range.kind === 'partial') {
      context.header('Content-Range', `bytes ${range.start}-${range.end}/${file.sizeBytes}`);
      context.status(206);
    }
    if (context.req.method === 'HEAD') return context.body(null);

    return stream(context, async (writer) => {
      if (file.kind === 'remote') {
        const response = await fetch(file.remoteUrl!, {
          headers: { Range: `bytes=${range.start}-${range.end}` },
        });
        if (
          !response.ok ||
          !response.body ||
          (range.kind === 'partial' && response.status !== 206)
        ) {
          throw new Error(`object-playback-${response.status}`);
        }
        let remaining = contentLength;
        for await (const chunk of response.body) {
          if (remaining <= 0) break;
          const bytes = chunk.subarray(0, remaining);
          await writer.write(bytes);
          remaining -= bytes.byteLength;
        }
        if (remaining !== 0) throw new Error('object-playback-truncated');
        return;
      }
      const readable = createReadStream(file.absolutePath!, { start: range.start, end: range.end });
      writer.onAbort(() => {
        readable.destroy();
      });
      try {
        for await (const chunk of readable) await writer.write(chunk);
      } finally {
        readable.destroy();
      }
    });
  });
  app.post('/api/audio-files/:audioFileId/transcript-confirmations', async (context) => {
    const input = AudioTranscriptConfirmationRequestSchema.parse(await context.req.json());
    return context.json(
      await service.confirmAudioTranscript(entityId(context.req.param('audioFileId')), input),
      201,
    );
  });
  app.delete('/api/audio-files/:audioFileId/speaker-review-findings/:findingId', async (context) =>
    context.json(
      SpeakerReviewResolutionResponseSchema.parse(
        await service.resolveSpeakerReviewFinding(
          entityId(context.req.param('audioFileId')),
          entityId(context.req.param('findingId')),
        ),
      ),
    ),
  );
  app.delete('/api/audio-files/:audioFileId/speaker-review-findings', async (context) =>
    context.json(
      SpeakerReviewResolutionResponseSchema.parse(
        await service.resolveAllSpeakerReviewFindings(entityId(context.req.param('audioFileId'))),
      ),
    ),
  );
  app.get('/api/audio-transcription/capabilities', async (context) =>
    context.json(await service.getAudioTranscriptionCapabilities()),
  );
  app.post('/api/audio-files/:audioFileId/transcriptions', async (context) => {
    const input = AudioTranscriptionStartRequestSchema.parse(await context.req.json());
    return context.json(
      await service.startAudioTranscription(entityId(context.req.param('audioFileId')), input),
      202,
    );
  });
  app.get('/api/audio-files/:audioFileId/transcriptions', async (context) =>
    context.json(await service.listAudioTranscriptions(entityId(context.req.param('audioFileId')))),
  );
  app.put('/api/audio-files/:audioFileId/transcript-selection', async (context) =>
    context.json(
      await service.selectAudioTranscription(
        entityId(context.req.param('audioFileId')),
        AudioTranscriptSelectionRequestSchema.parse(await context.req.json()),
      ),
    ),
  );
  app.post('/api/audio-files/:audioFileId/analysis/emotion', async (context) =>
    context.json(
      await service.startAudioPostAnalysis(entityId(context.req.param('audioFileId')), 'emotion'),
      202,
    ),
  );
  app.post('/api/audio-files/:audioFileId/analysis/role', async (context) =>
    context.json(
      await service.startAudioPostAnalysis(entityId(context.req.param('audioFileId')), 'role'),
      202,
    ),
  );
}
