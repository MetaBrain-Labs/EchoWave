/**
 * API 服务进程生命周期。
 *
 * 负责等待 HTTP 监听成功后再启动后台 Worker，并在信号或监听失败时幂等释放网络与运行时资源。
 *
 * Responsibilities:
 * - 防止端口占用时留下仍可领取数据库任务的无监听 Worker。
 * - 为 Ctrl+C、SIGTERM 和运行时监听错误提供同一套有界关闭流程。
 *
 * Notes:
 * - 强制退出只在优雅关闭超过时限时触发，正常关闭不会跳过资源释放。
 */
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

/** 生命周期只依赖 HTTP/1、HTTPS 与 HTTP/2 服务器共有的最小接口。 */
export type ManagedHttpServer = {
  listening: boolean;
  once(event: 'error', listener: (error: Error) => void): unknown;
  once(event: 'listening', listener: () => void): unknown;
  off(event: 'error', listener: (error: Error) => void): unknown;
  off(event: 'listening', listener: () => void): unknown;
  close(callback: (error?: Error) => void): unknown;
  closeAllConnections?: () => void;
};

/** 等待 Node HTTP Server 确认监听，监听错误会原样拒绝。 */
export function waitForHttpServerListening(server: ManagedHttpServer): Promise<void> {
  if (server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      server.off('error', onError);
      server.off('listening', onListening);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onListening = () => {
      cleanup();
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
  });
}

/** 仅在 HTTP 已经可接收请求后启动后台 Worker。 */
export async function startWorkersAfterListening(
  server: ManagedHttpServer,
  startWorkers: () => Promise<void>,
): Promise<void> {
  await waitForHttpServerListening(server);
  await startWorkers();
}

function closeHttpServer(server: ManagedHttpServer): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

/**
 * 创建幂等关闭函数；网络先停止接收新请求，再关闭 Worker、连接池和 checkpointer。
 */
export function createGracefulShutdown(options: {
  server: ManagedHttpServer;
  closeRuntime: () => Promise<void>;
  timeoutMs?: number;
  forceExit?: (code: number) => never | void;
}): (exitCode?: number) => Promise<void> {
  let pending: Promise<void> | undefined;
  return (exitCode = 0) => {
    if (pending) return pending;
    pending = (async () => {
      const timeout = setTimeout(() => {
        options.server.closeAllConnections?.();
        (options.forceExit ?? process.exit)(exitCode === 0 ? 1 : exitCode);
      }, options.timeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS);
      timeout.unref();

      let firstError: unknown;
      try {
        await closeHttpServer(options.server);
      } catch (error) {
        firstError = error;
      }
      try {
        await options.closeRuntime();
      } catch (error) {
        firstError ??= error;
      } finally {
        clearTimeout(timeout);
      }
      if (firstError) throw firstError;
    })();
    return pending;
  };
}
