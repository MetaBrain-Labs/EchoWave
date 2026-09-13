/**
 * 引用来源生命周期读取。
 *
 * 通过文档和版本审计记录解析状态，不依赖可被后台清理的 chunk。
 *
 * Responsibilities:
 * - 在可信租户范围批量识别当前、旧版、删除和不可用来源。
 *
 * Notes:
 * - 不修改历史标题、引文或分析结果。
 */
import { quoteIdentifier, type DatabasePool } from '../../infrastructure/postgres.ts';

/** 引用状态计算所需的最小快照字段。 */
type SourceReference = { documentId: string; revisionId?: string | null; knowledgeBaseId?: string };
/** 为不可变快照附加来源当前状态，所有查询均使用服务器租户。 */
export async function resolveCitationSources<T extends SourceReference>(
  pool: Pick<DatabasePool, 'query'>,
  schema: string,
  tenantId: string,
  citations: T[],
) {
  if (!citations.length) return [];
  const table = (name: string) => `${quoteIdentifier(schema)}.${quoteIdentifier(name)}`;
  const result = await pool.query(
    `SELECT d.id,d.knowledge_base_id,d.deleted_at,d.active_revision_id,
    kb.deleted_at AS kb_deleted_at,r.id AS revision_id
    FROM ${table('documents')} d JOIN ${table('knowledge_bases')} kb
      ON kb.tenant_id=d.tenant_id AND kb.id=d.knowledge_base_id
    LEFT JOIN ${table('document_revisions')} r ON r.tenant_id=d.tenant_id AND r.document_id=d.id
      AND r.id=ANY($3::uuid[])
    WHERE d.tenant_id=$1 AND d.id=ANY($2::uuid[])`,
    [
      tenantId,
      citations.map((c) => c.documentId),
      citations.flatMap((c) => (c.revisionId ? [c.revisionId] : [])),
    ],
  );
  return citations.map((citation) => {
    const rows = result.rows.filter(
      (row) =>
        row.id === citation.documentId &&
        (!citation.knowledgeBaseId || row.knowledge_base_id === citation.knowledgeBaseId),
    );
    const document = rows[0];
    const known = rows.some((row) => row.revision_id === citation.revisionId);
    const sourceStatus: 'active' | 'superseded' | 'deleted' | 'unavailable' =
      !document || (Boolean(citation.revisionId) && !known)
        ? 'unavailable'
        : document.deleted_at || document.kb_deleted_at
          ? 'deleted'
          : !citation.revisionId
            ? 'unavailable'
            : document.active_revision_id === citation.revisionId
              ? 'active'
              : 'superseded';
    return { ...citation, sourceStatus };
  });
}
