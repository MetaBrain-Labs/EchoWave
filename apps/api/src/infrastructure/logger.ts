/**
 * API 运行日志核心。
 *
 * 封装 Pino 单例、敏感字段脱敏与基于 AsyncLocalStorage 的请求/任务上下文，
 * 使任意深度的调用点无需层层传参即可自动附带 requestId、jobId 等字段。
 *
 * Responsibilities:
 * - 按 LoggingConfig 创建根 Logger（生产 JSON，本地 prettier）。
 * - 通过 mixin 把当前异步上下文合并进每一条日志。
 * - 提供 runWithLogContext / updateLogContext 维护上下文。
 *
 * Notes:
 * - 未调用 configureLogger 之前保持沉默，避免测试进程产生噪声输出；真实进程
 *   （bootstrap/server.ts、bootstrap/migrate.ts）必须先配置再记录日志。
 * - updateLogContext 是就地修改当前上下文对象，同一条异步链路内假定单写入者。
 * - 严禁记录请求 body、headers、完整 Prompt 或转写正文；redact 只是第二层防护。
 */
import { AsyncLocalStorage } from 'node:async_hooks';

import pino, { type DestinationStream, type Logger, type LoggerOptions } from 'pino';

import type { LoggingConfig } from '../config/logging.ts';

export type LogContext = {
  requestId?: string;

  tenantId?: string;
  workspaceId?: string;
  userId?: string;

  jobId?: string;
  taskId?: string;
  audioFileId?: string;

  component?: string;
};

const contextStorage = new AsyncLocalStorage<LogContext>();

/**
 * 已创建的具名子 Logger 注册表。
 *
 * 子 Logger 一旦创建就绑定当时那个根 Logger；configureLogger 会整体替换根 Logger，
 * 因此必须在这里重建，否则早期模块持有的引用会永远写入被丢弃的旧实例。
 */
const namedLoggers = new Map<string, Logger>();

let rootLogger: Logger = pino({ level: 'silent' });

function rebuildNamedLoggers(): void {
  for (const [component, logger] of namedLoggers) {
    namedLoggers.set(component, rootLogger.child(logger.bindings() as Record<string, unknown>));
  }
}

function createLoggerOptions(config: LoggingConfig): LoggerOptions {
  return {
    level: config.level,
    base: { service: 'echowave-api' },
    redact: {
      paths: [
        'password',
        '*.password',

        'authorization',
        'headers.authorization',
        'req.headers.authorization',

        'cookie',
        'headers.cookie',
        'req.headers.cookie',

        'accessToken',
        '*.accessToken',
        'refreshToken',
        '*.refreshToken',

        'apiKey',
        '*.apiKey',

        'accessKeySecret',
        '*.accessKeySecret',

        'credentialMasterKey',
        '*.credentialMasterKey',
      ],
      censor: '[REDACTED]',
    },
    mixin() {
      const context = contextStorage.getStore();
      return context ? { ...context } : {};
    },
  };
}

/**
 * 按配置重建根 Logger。
 *
 * destination 仅供测试注入内存流；生产路径不传，日志写入 stdout。
 */
export function configureLogger(config: LoggingConfig, destination?: DestinationStream): void {
  const options = createLoggerOptions(config);
  const transport =
    config.format === 'pretty'
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
          },
        }
      : {};
  rootLogger = pino({ ...options, ...transport }, destination);
  rebuildNamedLoggers();
}

/** 返回当前根 Logger。 */
export function getLogger(): Logger {
  return rootLogger;
}

/**
 * 返回指定组件的具名子 Logger。
 *
 * 模块可以安全地在顶层创建：configureLogger 重建根 Logger 时会一并重建这些引用。
 * 需要按任务维度区分时，调用返回值的 child({ jobId, ... })。
 */
export function childLogger(component: string): Logger {
  const existing = namedLoggers.get(component);
  if (existing) return existing;
  const logger = rootLogger.child({ component });
  namedLoggers.set(component, logger);
  return logger;
}

/** 在指定日志上下文中执行回调，回调内产生的日志自动携带这些字段。 */
export function runWithLogContext<T>(context: LogContext, callback: () => T): T {
  return contextStorage.run(context, callback);
}

/** 认证或任务领取后补全当前上下文，失败静默（无上下文时无需补全）。 */
export function updateLogContext(fields: Partial<LogContext>): void {
  const current = contextStorage.getStore();
  if (!current) return;
  Object.assign(current, fields);
}
