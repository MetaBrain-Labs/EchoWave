/**
 * 数据库迁移文件选择规则。
 *
 * 只允许三位递增编号开头的业务 migration 进入执行序列，避免把数据库快照或
 * 临时 SQL 文件误当成可重复部署的迁移。
 *
 * Responsibilities:
 * - 过滤符合命名约定的 SQL migration。
 * - 返回按文件名稳定排序的执行序列。
 *
 * Notes:
 * - `sql.sql`、`trigger.sql` 等非编号文件不是迁移历史的一部分。
 */

const MIGRATION_FILE_PATTERN = /^\d{3}_[a-z0-9_]+\.sql$/;

/** 从目录条目中选择并排序权威业务 migration。 */
export function orderedMigrationFileNames(names: readonly string[]): string[] {
  return names.filter((name) => MIGRATION_FILE_PATTERN.test(name)).sort();
}
