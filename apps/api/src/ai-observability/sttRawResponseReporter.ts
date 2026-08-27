/**
 * STT 原始响应测试报告器。
 *
 * 在显式开发开关启用时，为 DashScope STT HTTP 响应生成独立 JSON 文件，
 * 供模型逐项测试和响应结构比对使用。
 *
 * Responsibilities:
 * - 记录安全请求元数据、响应状态和经过保护的原始响应正文。
 * - 对正文执行大小限制、哈希和敏感内容脱敏。
 * - 正文可解析为 JSON 时以结构化 rawResponseBody 写入，否则保留 rawResponseText 字符串。
 * - 隔离目录创建或文件写入失败，避免影响转写业务结果。
 *
 * Notes:
 * - 本模块不接收或记录请求正文、音频、鉴权头和完整响应头。
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  AudioTranscriptionModel,
  AudioTranscriptionPreprocessing,
  AudioTranscriptionProvider,
} from '@echowave/contracts';

export const MAX_STT_RAW_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_REPOSITORY_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

export type SttRawResponseOutcome =
  'completed' | 'http_error' | 'invalid_json' | 'validation_error';
export type SttRawResponseKind =
  'transcription' | 'task_submission' | 'task_status' | 'transcription_result';

/** 单次 STT 供应商响应可进入报告器的白名单字段。 */
export type SttRawResponseReportInput = {
  revisionId: string;
  model: AudioTranscriptionModel;
  preprocessing: AudioTranscriptionPreprocessing;
  format: 'mp3';
  chunkIndex: number;
  chunkCount: number;
  durationMs: number;
  networkAttempt: number;
  httpStatus: number;
  contentType?: string;
  generationId?: string;
  outcome: SttRawResponseOutcome;
  rawResponseText: string;
  provider?: AudioTranscriptionProvider;
  responseKind?: SttRawResponseKind;
};

/** 与通用 Markdown 执行报告解耦的 STT 响应报告接口。 */
export interface SttRawResponseReporter {
  record(input: SttRawResponseReportInput): Promise<void>;
}

type ReporterDependencies = {
  repositoryRoot?: string;
  now?: () => Date;
  createId?: () => string;
  writeReport?: (filePath: string, content: string) => Promise<void>;
  warn?: (message: string) => void;
};

export const noOpSttRawResponseReporter: SttRawResponseReporter = {
  record: async () => undefined,
};

/** 按独立开关创建逐响应 JSON 报告器。 */
export function createSttRawResponseReporter(
  config: { enabled: boolean; outputDirectory: string },
  dependencies: ReporterDependencies = {},
): SttRawResponseReporter {
  if (!config.enabled) return noOpSttRawResponseReporter;

  const repositoryRoot = dependencies.repositoryRoot ?? DEFAULT_REPOSITORY_ROOT;
  const outputRoot = path.isAbsolute(config.outputDirectory)
    ? config.outputDirectory
    : path.resolve(repositoryRoot, config.outputDirectory);
  const now = dependencies.now ?? (() => new Date());
  const createId = dependencies.createId ?? randomUUID;
  const writeReport =
    dependencies.writeReport ??
    (async (filePath: string, content: string) => {
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content, 'utf8');
    });
  const warn = dependencies.warn ?? ((message: string) => console.warn(message));

  return {
    async record(input) {
      try {
        const capturedAt = now();
        const rawBytes = Buffer.from(input.rawResponseText, 'utf8');
        const truncated = rawBytes.length > MAX_STT_RAW_RESPONSE_BYTES;
        const boundedText = truncated
          ? rawBytes.subarray(0, MAX_STT_RAW_RESPONSE_BYTES).toString('utf8')
          : input.rawResponseText;
        const sanitized = sanitizeRawResponse(boundedText);
        const structuredBody = parseJsonBody(sanitized.value);
        const report = {
          schemaVersion: 2,
          capturedAt: capturedAt.toISOString(),
          revisionId: input.revisionId,
          model: input.model,
          provider: input.provider ?? 'dashscope',
          responseKind: input.responseKind ?? 'transcription',
          preprocessing: input.preprocessing,
          format: input.format,
          chunk: {
            index: input.chunkIndex,
            count: input.chunkCount,
            durationMs: input.durationMs,
          },
          networkAttempt: input.networkAttempt,
          response: {
            httpStatus: input.httpStatus,
            ...(input.contentType ? { contentType: input.contentType } : {}),
            ...(input.generationId ? { generationId: input.generationId } : {}),
            outcome: input.outcome,
            bodyByteLength: rawBytes.length,
            bodySha256: createHash('sha256').update(rawBytes).digest('hex'),
            truncated,
            redactionCount: sanitized.redactionCount,
            // 合法 JSON 以结构化对象呈现便于逐项比对；非法或截断正文回退为字符串。
            ...(structuredBody === undefined
              ? { rawResponseText: sanitized.value }
              : { rawResponseBody: structuredBody }),
          },
        };
        const dateDirectory = capturedAt.toISOString().slice(0, 10);
        const timestamp = capturedAt.toISOString().replace(/[:.]/g, '-');
        const fileName = [
          timestamp,
          `revision-${safeSegment(input.revisionId)}`,
          `chunk-${input.chunkIndex}-of-${input.chunkCount}`,
          `attempt-${input.networkAttempt}`,
          safeSegment(input.responseKind ?? 'transcription'),
          safeSegment(createId()),
        ].join('-');
        const filePath = path.join(outputRoot, 'stt-raw', dateDirectory, `${fileName}.json`);
        await writeReport(filePath, `${JSON.stringify(report, null, 2)}\n`);
      } catch {
        // 测试诊断属于旁路能力，绝不能覆盖真实转写结果。
        warn('[stt-raw-response-report] failed to write response report');
      }
    },
  };
}

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80) || 'unknown';
}

/** 尝试将脱敏后的正文解析为结构化 JSON，失败返回 undefined。 */
function parseJsonBody(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function sanitizeRawResponse(value: string): { value: string; redactionCount: number } {
  let redactionCount = 0;
  const replace = (pattern: RegExp, replacement: string) => {
    redactionCount += [...value.matchAll(pattern)].length;
    value = value.replace(pattern, replacement);
  };

  replace(/(Bearer\s+)[^\s"']+/gi, '$1[REDACTED]');
  replace(
    /("(?:api[_-]?key|authorization|password|secret|access[_-]?token)"\s*:\s*")[^"]*(")/gi,
    '$1[REDACTED]$2',
  );
  replace(/\b[A-Za-z0-9+/]{256,}={0,2}\b/g, '[REDACTED_BASE64]');
  replace(/\b[A-Za-z]:\\(?:[^\s"']+\\)*[^\s"']*/g, '[REDACTED_PATH]');
  replace(/([a-z][a-z0-9+.-]*:\/\/[^:\s/]+:)[^@\s/]+@/gi, '$1[REDACTED]@');
  replace(
    /([?&](?:OSSAccessKeyId|Signature|Expires|x-oss-signature|x-oss-credential|x-oss-security-token)=)[^&"\s]+/gi,
    '$1[REDACTED]',
  );
  return { value, redactionCount };
}
