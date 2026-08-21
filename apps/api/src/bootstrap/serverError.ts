/**
 * API 启动错误格式化工具。
 *
 * 将 Node 监听器错误转换为简洁、可操作且不泄露内部状态的启动提示。
 *
 * Responsibilities:
 * - 识别端口占用等常见启动故障。
 * - 为未知监听错误提供稳定兜底信息。
 *
 * Notes:
 * - 本文件只生成消息，不记录日志或终止进程。
 */
/** 将 Node 监听错误映射为不泄密且可操作的启动消息。 */
export function formatServerStartError(error: Error, port: number): string {
  if ('code' in error && error.code === 'EADDRINUSE') {
    return `EchoWave API could not start: port ${port} is already in use. Stop the existing process or change PORT in apps/api/.env.`;
  }

  return `EchoWave API could not start: ${error.message}`;
}
