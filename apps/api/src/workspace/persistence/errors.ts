/**
 * 音频工作区持久化错误。
 *
 * 为只读工作区查询提供稳定的未找到错误，避免向 HTTP 层泄露 PostgreSQL 细节。
 *
 * Responsibilities:
 * - 标识可安全映射的仓储错误。
 */
export class WorkspaceRepositoryError extends Error {
  constructor(public readonly code: 'NOT_FOUND', message: string) {
    super(message);
    this.name = 'WorkspaceRepositoryError';
  }
}
