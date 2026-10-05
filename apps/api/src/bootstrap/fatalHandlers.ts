/**
 * API 进程级致命异常处理。
 *
 * 记录未捕获异常与未处理 Promise 拒绝，并触发优雅停机，避免进程在未知状态下继续服务。
 *
 * Responsibilities:
 * - 把非 Error 的拒绝原因归一为 Error，保留可读堆栈。
 * - 以 fatal 级别记录后交给调用方提供的停机流程。
 *
 * Notes:
 * - 返回卸载函数，便于测试在不污染进程监听器的情况下验证行为。
 * - 必须复用 createGracefulShutdown 的幂等停机，正常停机路径改为设置 process.exitCode，
 *   使日志传输有机会把最后几条记录写出。
 */
import { getLogger } from '../infrastructure/logger.ts';

export type FatalHandlerOptions = {
  shutdown: (exitCode: number) => void;
};

function normalizedError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

/** 注册 uncaughtException 与 unhandledRejection 的 fatal 日志与停机流程。 */
export function registerFatalHandlers(options: FatalHandlerOptions): () => void {
  const onUncaughtException = (error: Error) => {
    getLogger().fatal({ err: error }, 'Uncaught exception');
    options.shutdown(1);
  };
  const onUnhandledRejection = (reason: unknown) => {
    getLogger().fatal({ err: normalizedError(reason) }, 'Unhandled promise rejection');
    options.shutdown(1);
  };

  process.once('uncaughtException', onUncaughtException);
  process.once('unhandledRejection', onUnhandledRejection);

  return () => {
    process.off('uncaughtException', onUncaughtException);
    process.off('unhandledRejection', onUnhandledRejection);
  };
}
