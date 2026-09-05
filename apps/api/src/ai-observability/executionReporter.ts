/**
 * AI 执行报告记录器。
 *
 * 为知识问答、入库和后续工作流提供与具体 Agent/图框架无关的运行记录接口，并在
 * 执行结束时生成一份本地 Markdown 诊断摘要。
 *
 * Responsibilities:
 * - 收集步骤、模型、工具、上下文、推理与输出事件。
 * - 对诊断内容执行脱敏、截断和安全序列化。
 * - 保证关闭或写入失败时不影响业务执行。
 *
 * Notes:
 * - 本模块只写本地诊断文件，不提供持久化、查询 API 或实时事件流。
 */
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

const MAX_SECTION_CHARACTERS = 120_000;
const DEFAULT_REPOSITORY_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const SENSITIVE_KEYS = new Set([
  'apikey',
  'api_key',
  'authorization',
  'cookie',
  'set_cookie',
  'password',
  'secret',
  'token',
  'clientsecret',
  'client_secret',
  'privatekey',
  'private_key',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'databaseurl',
  'database_url',
  'connectionstring',
  'connection_string',
]);

/** 已知的首期执行类型，同时允许未来工作流使用稳定的自定义名称。 */
export type AiExecutionKind =
  | 'audio-transcription'
  | 'audio-business-analysis'
  | 'audio-role-recognition'
  | 'audio-speaker-review'
  | 'audio-emotion-analysis'
  | 'rag-answer'
  | 'knowledge-ingestion'
  | (string & {});

/** AI 执行报告的运行时配置。 */
export type AiExecutionReportConfig = {
  enabled: boolean;
  outputDirectory: string;
  includeContext: boolean;
  includeToolContent: boolean;
  includeOutput: boolean;
  includeReasoning: boolean;
};

/** 创建一次 AI 执行记录所需的稳定元数据。 */
export type AiExecutionStart = {
  kind: AiExecutionKind;
  name: string;
  fileId?: string;
  metadata?: Record<string, unknown>;
};

/** 工作流步骤的状态转换事件。 */
export type AiStepEvent = {
  name: string;
  status: 'started' | 'completed' | 'failed';
  durationMs?: number;
  metadata?: Record<string, unknown>;
};

/** 一次模型调用的安全统计，以及必须记录的真实输入与可见输出。 */
export type AiModelCallEvent = {
  name: string;
  displayName?: string;
  provider: string;
  model: string;
  status: 'completed' | 'failed';
  attempt: number;
  input: unknown;
  output: unknown;
  durationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCost?: { amount: number; currency: 'CNY' | 'USD' };
  reasoningMode?: 'streaming' | 'disabled' | 'unsupported';
  metadata?: Record<string, unknown>;
};

/** 一次模型调用开始时即可公开的稳定信息。 */
export type AiModelCallStart = Pick<
  AiModelCallEvent,
  'name' | 'displayName' | 'provider' | 'model' | 'attempt' | 'reasoningMode' | 'metadata'
> & { operationId?: string };

/** 一次模型调用结束后才能获得的状态、计量和诊断正文。 */
export type AiModelCallFinish = Pick<
  AiModelCallEvent,
  | 'status'
  | 'input'
  | 'output'
  | 'durationMs'
  | 'inputTokens'
  | 'outputTokens'
  | 'estimatedCost'
  | 'metadata'
>;

/** 跨模型等待期持续接收 reasoning 并最终收口调用状态。 */
export interface AiModelCallSpan {
  readonly operationId: string;
  appendReasoning(delta: string): void;
  finish(event: AiModelCallFinish): void;
}

/** 一次工具调用的统计；输入输出正文由独立开关保护。 */
export type AiToolCallEvent = {
  name: string;
  displayName?: string;
  status: 'completed' | 'failed';
  durationMs?: number;
  summary?: Record<string, unknown>;
  input?: unknown;
  output?: unknown;
};

/** 一次工具调用开始时可审计的目标与安全摘要。 */
export type AiToolCallStart = Pick<AiToolCallEvent, 'name' | 'displayName' | 'summary'> & {
  operationId?: string;
};

/** 在工具完成或失败时更新同一条运行中记录。 */
export interface AiToolCallSpan {
  readonly operationId: string;
  finish(
    event: Pick<AiToolCallEvent, 'status' | 'durationMs' | 'summary' | 'input' | 'output'>,
  ): void;
}

/** 一次执行的最终状态。 */
export type AiExecutionResult = {
  status: 'completed' | 'failed';
  error?: unknown;
  metadata?: Record<string, unknown>;
};

/** 单次运行可使用的框架无关诊断接口。 */
export interface AiExecutionRecorder {
  recordMetadata(metadata: Record<string, unknown>): void;
  recordStep(event: AiStepEvent): void;
  beginModelCall(event: AiModelCallStart): AiModelCallSpan;
  recordModelCall(event: AiModelCallEvent): void;
  beginToolCall(event: AiToolCallStart): AiToolCallSpan;
  recordToolCall(event: AiToolCallEvent): void;
  recordContext(value: unknown): void;
  recordReasoning(value: unknown): void;
  recordOutput(value: unknown): void;
  finish(result: AiExecutionResult): Promise<void>;
}

const noOpModelCallSpan: AiModelCallSpan = {
  operationId: '00000000-0000-4000-8000-000000000000',
  appendReasoning: () => undefined,
  finish: () => undefined,
};

const noOpToolCallSpan: AiToolCallSpan = {
  operationId: '00000000-0000-4000-8000-000000000000',
  finish: () => undefined,
};

/** 创建单次 AI 执行记录的入口。 */
export interface AiExecutionReporter {
  start(input: AiExecutionStart): AiExecutionRecorder;
}

type ReporterDependencies = {
  repositoryRoot?: string;
  now?: () => Date;
  createId?: () => string;
  writeReport?: (filePath: string, content: string) => Promise<void>;
  warn?: (message: string) => void;
};

type RecordedEvent<T> = T & { at: string };

/** 未启用报告时供工作流和模型中间件共享的无操作记录器。 */
export const noOpAiExecutionRecorder: AiExecutionRecorder = {
  recordMetadata: () => undefined,
  recordStep: () => undefined,
  beginModelCall: () => noOpModelCallSpan,
  recordModelCall: () => undefined,
  beginToolCall: () => noOpToolCallSpan,
  recordToolCall: () => undefined,
  recordContext: () => undefined,
  recordReasoning: () => undefined,
  recordOutput: () => undefined,
  finish: async () => undefined,
};

/** 未注入报告器的测试或局部组合可复用的无操作实现。 */
export const noOpAiExecutionReporter: AiExecutionReporter = {
  start: () => noOpAiExecutionRecorder,
};

/**
 * 开始一次可实时更新的模型调用，并兼容只实现旧版终态方法的旁路记录器。
 *
 * 旧记录器仍会在结束时收到完整模型事件；reasoning 则沿用其独立推理记录入口。
 */
export function beginAiModelCall(
  recorder: AiExecutionRecorder,
  event: AiModelCallStart,
): AiModelCallSpan {
  const begin = (recorder as Partial<AiExecutionRecorder>).beginModelCall;
  if (typeof begin === 'function') return begin.call(recorder, event);

  const operationId = event.operationId ?? randomUUID();
  return {
    operationId,
    appendReasoning: (delta) => {
      if (delta) recorder.recordReasoning(delta);
    },
    finish: (result) => recorder.recordModelCall({ ...event, ...result }),
  };
}

/** 开始一次可实时更新的工具调用，并兼容只实现旧版终态方法的旁路记录器。 */
export function beginAiToolCall(
  recorder: AiExecutionRecorder,
  event: AiToolCallStart,
): AiToolCallSpan {
  const begin = (recorder as Partial<AiExecutionRecorder>).beginToolCall;
  if (typeof begin === 'function') return begin.call(recorder, event);

  const operationId = event.operationId ?? randomUUID();
  return {
    operationId,
    finish: (result) => recorder.recordToolCall({ ...event, ...result }),
  };
}

/** 将多个旁路报告器组合为一个接口，单个报告器失败不阻断其他报告器。 */
export function createCompositeAiExecutionReporter(
  reporters: readonly AiExecutionReporter[],
): AiExecutionReporter {
  return {
    start(input) {
      const recorders = reporters.map((reporter) => reporter.start(input));
      return {
        recordMetadata: (metadata) => recorders.forEach((item) => item.recordMetadata(metadata)),
        recordStep: (event) => recorders.forEach((item) => item.recordStep(event)),
        beginModelCall: (event) => {
          const operationId = event.operationId ?? randomUUID();
          const spans = recorders.map((item) => beginAiModelCall(item, { ...event, operationId }));
          return {
            operationId,
            appendReasoning: (delta) => spans.forEach((span) => span.appendReasoning(delta)),
            finish: (result) => spans.forEach((span) => span.finish(result)),
          };
        },
        recordModelCall: (event) => recorders.forEach((item) => item.recordModelCall(event)),
        beginToolCall: (event) => {
          const operationId = event.operationId ?? randomUUID();
          const spans = recorders.map((item) => beginAiToolCall(item, { ...event, operationId }));
          return {
            operationId,
            finish: (result) => spans.forEach((span) => span.finish(result)),
          };
        },
        recordToolCall: (event) => recorders.forEach((item) => item.recordToolCall(event)),
        recordContext: (value) => recorders.forEach((item) => item.recordContext(value)),
        recordReasoning: (value) => recorders.forEach((item) => item.recordReasoning(value)),
        recordOutput: (value) => recorders.forEach((item) => item.recordOutput(value)),
        finish: async (result) => {
          await Promise.allSettled(recorders.map((item) => item.finish(result)));
        },
      };
    },
  };
}

/** 根据显式配置创建文件报告器；关闭时所有运行共享无操作实现。 */
export function createAiExecutionReporter(
  config: AiExecutionReportConfig,
  dependencies: ReporterDependencies = {},
): AiExecutionReporter {
  if (!config.enabled) return noOpAiExecutionReporter;

  const repositoryRoot = dependencies.repositoryRoot ?? DEFAULT_REPOSITORY_ROOT;
  const outputDirectory = path.isAbsolute(config.outputDirectory)
    ? config.outputDirectory
    : path.resolve(repositoryRoot, config.outputDirectory);
  const now = dependencies.now ?? (() => new Date());
  const createId = dependencies.createId ?? randomUUID;
  const writeReport =
    dependencies.writeReport ??
    (async (filePath: string, content: string) => {
      await mkdir(path.dirname(filePath), { recursive: true });
      const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporaryPath, content, 'utf8');
        await rename(temporaryPath, filePath);
      } catch (error) {
        await rm(temporaryPath, { force: true }).catch(() => undefined);
        throw error;
      }
    });
  const warn = dependencies.warn ?? ((message: string) => console.warn(message));

  return {
    start(input) {
      return new MarkdownExecutionRecorder(
        config,
        input,
        outputDirectory,
        now,
        createId(),
        writeReport,
        warn,
      );
    },
  };
}

class MarkdownExecutionRecorder implements AiExecutionRecorder {
  private readonly startedAt: Date;
  private readonly metadata: Record<string, unknown>;
  private readonly steps: RecordedEvent<AiStepEvent>[] = [];
  private readonly modelCalls: RecordedEvent<AiModelCallEvent>[] = [];
  private readonly toolCalls: RecordedEvent<AiToolCallEvent>[] = [];
  private readonly contexts: unknown[] = [];
  private readonly reasoning: unknown[] = [];
  private readonly outputs: unknown[] = [];
  private finished = false;

  constructor(
    private readonly config: AiExecutionReportConfig,
    private readonly input: AiExecutionStart,
    private readonly outputDirectory: string,
    private readonly now: () => Date,
    private readonly executionId: string,
    private readonly writeReport: (filePath: string, content: string) => Promise<void>,
    private readonly warn: (message: string) => void,
  ) {
    this.startedAt = now();
    this.metadata = { ...input.metadata };
  }

  recordMetadata(metadata: Record<string, unknown>): void {
    Object.assign(this.metadata, metadata);
  }

  recordStep(event: AiStepEvent): void {
    this.steps.push({ ...event, at: this.now().toISOString() });
  }

  beginModelCall(event: AiModelCallStart): AiModelCallSpan {
    const operationId = event.operationId ?? randomUUID();
    const reasoning: string[] = [];
    return {
      operationId,
      appendReasoning: (delta) => {
        if (delta) reasoning.push(delta);
      },
      finish: (result) => {
        this.recordModelCall({ ...event, ...result });
        if (reasoning.length > 0) this.recordReasoning(reasoning.join(''));
      },
    };
  }

  recordModelCall(event: AiModelCallEvent): void {
    this.modelCalls.push({
      ...event,
      input: protectModelPayload(event.input),
      output: protectModelPayload(event.output),
      at: this.now().toISOString(),
    });
  }

  beginToolCall(event: AiToolCallStart): AiToolCallSpan {
    const operationId = event.operationId ?? randomUUID();
    return {
      operationId,
      finish: (result) => this.recordToolCall({ ...event, ...result }),
    };
  }

  recordToolCall(event: AiToolCallEvent): void {
    const protectedEvent = this.config.includeToolContent
      ? event
      : { ...event, input: undefined, output: undefined };
    this.toolCalls.push({ ...protectedEvent, at: this.now().toISOString() });
  }

  recordContext(value: unknown): void {
    if (this.config.includeContext) this.contexts.push(value);
  }

  recordReasoning(value: unknown): void {
    if (this.config.includeReasoning) this.reasoning.push(value);
  }

  recordOutput(value: unknown): void {
    if (this.config.includeOutput) this.outputs.push(value);
  }

  async finish(result: AiExecutionResult): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    let diagnosticTarget = path.basename(this.outputDirectory);
    try {
      const endedAt = this.now();
      Object.assign(this.metadata, result.metadata);
      const content = this.render(result, endedAt);
      const dateDirectory = this.startedAt.toISOString().slice(0, 10);
      const timestamp = this.startedAt.toISOString().replace(/[:.]/g, '-');
      const kind = sanitizeFileSegment(this.input.kind);
      const fileId = sanitizeFileSegment(this.input.fileId ?? this.executionId);
      const fileName = `${timestamp}-${kind}-${fileId}.md`;
      const filePath = path.join(this.outputDirectory, dateDirectory, fileName);
      diagnosticTarget = path.join(path.basename(this.outputDirectory), dateDirectory, fileName);
      await this.writeReport(filePath, content);
    } catch (error) {
      // 诊断能力必须保持旁路，不能掩盖或改变原始 AI 执行结果。
      const code =
        error && typeof error === 'object' && 'code' in error ? String(error.code) : 'UNKNOWN';
      const message =
        error instanceof Error
          ? redactAiDiagnosticText(error.message).slice(0, 300)
          : 'Unknown report writer error';
      this.warn(
        `[ai-execution-report] failed to write execution report ${safeSerialize({
          code,
          error: error instanceof Error ? error.name : 'UnknownError',
          message,
          targetPath: diagnosticTarget,
        })}`,
      );
    }
  }

  private render(result: AiExecutionResult, endedAt: Date): string {
    const durationMs = Math.max(0, endedAt.getTime() - this.startedAt.getTime());
    const sections = [
      '# AI Execution Report',
      '',
      `- Execution ID: ${inline(this.executionId)}`,
      `- Kind: ${inline(this.input.kind)}`,
      `- Name: ${inline(this.input.name)}`,
      `- Status: ${result.status}`,
      `- Started: ${this.startedAt.toISOString()}`,
      `- Ended: ${endedAt.toISOString()}`,
      `- Duration: ${durationMs} ms`,
      '',
      renderJsonSection('Metadata', this.metadata),
      renderJsonSection('Step Timeline', this.steps),
      renderJsonSection('Model Calls', this.modelCalls, false),
      renderJsonSection('Tool Calls', this.toolCalls),
    ];

    if (this.config.includeContext) sections.push(renderJsonSection('Context', this.contexts));
    if (this.config.includeReasoning) sections.push(renderJsonSection('Reasoning', this.reasoning));
    if (this.config.includeOutput) sections.push(renderJsonSection('Output', this.outputs));
    if (result.error !== undefined)
      sections.push(renderJsonSection('Error', normalizeError(result.error)));

    return `${sections.filter(Boolean).join('\n')}\n`;
  }
}

function sanitizeFileSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80) || 'execution';
}

function inline(value: unknown): string {
  return redactAiDiagnosticText(String(value)).replace(/[\r\n]+/g, ' ');
}

function renderJsonSection(title: string, value: unknown, truncateSection = true): string {
  const serialized = safeSerialize(value);
  const truncated =
    truncateSection && serialized.length > MAX_SECTION_CHARACTERS
      ? `${serialized.slice(0, MAX_SECTION_CHARACTERS)}\n... [truncated]`
      : serialized;
  const fence = '`'.repeat(Math.max(3, longestBacktickRun(truncated) + 1));
  return `## ${title}\n\n${fence}json\n${truncated}\n${fence}\n`;
}

function longestBacktickRun(value: string): number {
  return Math.max(0, ...[...value.matchAll(/`+/g)].map((match) => match[0].length));
}

function safeSerialize(value: unknown): string {
  try {
    return JSON.stringify(normalizeValue(value, new Set()), null, 2) ?? 'null';
  } catch {
    return '"[Unserializable diagnostic value]"';
  }
}

function normalizeValue(value: unknown, ancestors: Set<object>): unknown {
  if (typeof value === 'bigint') return `${value}n`;
  if (value instanceof Error) return normalizeError(value);
  if (Array.isArray(value)) {
    if (ancestors.has(value)) return '[Circular]';
    ancestors.add(value);
    const normalized = value.map((item) => normalizeValue(item, ancestors));
    ancestors.delete(value);
    return normalized;
  }
  if (value && typeof value === 'object') {
    if (ancestors.has(value)) return '[Circular]';
    ancestors.add(value);
    const normalized: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      normalized[key] = isSensitiveKey(key) ? '[REDACTED]' : normalizeValue(item, ancestors);
    }
    ancestors.delete(value);
    return normalized;
  }
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
  if (typeof value === 'symbol') return String(value);
  if (typeof value === 'string') return redactAiDiagnosticText(value);
  return value;
}

function protectModelPayload(value: unknown): unknown {
  try {
    return normalizeModelPayload(value, new Set());
  } catch {
    // 不可信 Provider 对象即使含抛错 getter，也不能反向影响模型调用与业务发布。
    return '[Unserializable model payload]';
  }
}

function normalizeModelPayload(value: unknown, ancestors: Set<object>): unknown {
  if (typeof value === 'string') return truncateModelString(redactAiDiagnosticText(value));
  if (typeof value === 'bigint') return `${value}n`;
  if (value instanceof Error) return normalizeError(value);
  if (Array.isArray(value)) {
    if (ancestors.has(value)) return '[Circular]';
    ancestors.add(value);
    const normalized = value.map((item) => normalizeModelPayload(item, ancestors));
    ancestors.delete(value);
    return normalized;
  }
  if (value && typeof value === 'object') {
    if (ancestors.has(value)) return '[Circular]';
    ancestors.add(value);
    const normalized: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      normalized[key] = isSensitiveKey(key) ? '[REDACTED]' : normalizeModelPayload(item, ancestors);
    }
    ancestors.delete(value);
    return normalized;
  }
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
  if (typeof value === 'symbol') return String(value);
  return value;
}

function truncateModelString(value: string): string | Record<string, unknown> {
  if (value.length <= MAX_SECTION_CHARACTERS) return value;
  return {
    truncated: true,
    originalCharacters: value.length,
    sha256: createHash('sha256').update(value).digest('hex'),
    content: `${value.slice(0, MAX_SECTION_CHARACTERS)}\n... [truncated]`,
  };
}

function normalizeError(error: unknown): unknown {
  if (!(error instanceof Error)) return error;
  const code = 'code' in error ? error.code : undefined;
  return {
    name: error.name,
    message: error.message,
    ...(typeof code === 'string' ? { code } : {}),
  };
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase().replace(/[-\s]/g, '_'));
}

/** 对允许进入诊断或产品审计的自由文本执行基础秘密和本地路径过滤。 */
export function redactAiDiagnosticText(value: string): string {
  let redacted = value.replace(/(Bearer\s+)[^\s"']+/gi, '$1[REDACTED]');
  redacted = redacted.replace(/\b[A-Za-z0-9+/]{256,}={0,2}\b/g, '[REDACTED_BASE64]');
  redacted = redacted.replace(/\b[A-Za-z]:[\\/](?:[^\s"']+[\\/])*[^\s"']*/g, '[REDACTED_PATH]');
  redacted = redacted.replace(
    /\/(?:Users|home|tmp|private\/tmp|var\/tmp|workspace)\/(?:[^\s"']+\/)*[^\s"']*/g,
    '[REDACTED_PATH]',
  );
  redacted = redacted.replace(
    /([?&](?:signature|ossaccesskeyid|accesskeyid|security-token|x-oss-signature|x-oss-credential|x-oss-security-token|x-amz-signature|x-amz-credential|x-amz-security-token|expires)=)[^&#\s"']+/gi,
    '$1[REDACTED]',
  );
  if (redacted.includes('://')) {
    redacted = redacted.replace(/([a-z][a-z0-9+.-]*:\/\/[^:\s/]+:)[^@\s/]+@/gi, '$1[REDACTED]@');
  }
  return redacted;
}
