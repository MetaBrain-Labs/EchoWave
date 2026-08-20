/**
 * 知识持久层领域错误。
 *
 * 定义可跨多个知识仓储共享并由 HTTP 层稳定映射的错误类型。
 *
 * Responsibilities:
 * - 区分冲突、重复文档和实体不存在。
 *
 * Notes:
 * - 不包含 PostgreSQL 或 provider 原始错误信息。
 */

/** 可由传输层稳定映射的知识持久层领域错误。 */
export class RagRepositoryError extends Error {
  constructor(
    public readonly code: 'CONFLICT' | 'DUPLICATE_DOCUMENT' | 'NOT_FOUND',
    message: string,
  ) {
    super(message);
    this.name = 'RagRepositoryError';
  }
}
