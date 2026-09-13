/**
 * 知识数据清理任务仓储。
 *
 * 保存可恢复清理阶段和文件目标，保护仍在使用的 active 与最新版本。
 *
 * Responsibilities:
 * - 通过租约领取清理任务并原子删除失效 chunks。
 * - 保留失败原因与下次重试时间，不触及历史引用。
 *
 * Notes:
 * - 物理文件清理由 worker 执行，版本审计记录始终保留。
 */
import { quoteIdentifier, type DatabasePool } from '../../infrastructure/postgres.ts';

/** 清理执行持有的租约及不可变文件目标。 */
export type CleanupJob = {
  id: string;
  knowledge_base_id: string;
  document_id: string;
  revision_id: string;
  lease_token: string;
  storage_key: string | null;
  staged_path: string | null;
  attempts: number;
  stage: 'chunks' | 'files' | 'done';
};
/** 管理知识清理任务及文件引用的窄仓储。 */
export class KnowledgeCleanupRepository {
  constructor(
    private readonly pool: DatabasePool,
    private readonly schema: string,
    private readonly tenantId: string,
  ) {}
  private table(name: string) {
    return `${quoteIdentifier(this.schema)}.${quoteIdentifier(name)}`;
  }
  /** 领取待清理或失败重试任务，租约过期后可恢复。 */
  async claim(): Promise<CleanupJob | undefined> {
    const result = await this.pool.query(
      `WITH candidate AS (SELECT id FROM ${this.table('knowledge_cleanup_jobs')}
      WHERE tenant_id=$1 AND ((status IN ('queued','failed') AND next_attempt_at<=now()) OR
        (status='running' AND lease_until<now())) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
      UPDATE ${this.table('knowledge_cleanup_jobs')} j SET status='running',attempts=j.attempts+1,
        lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes',updated_at=now()
      FROM candidate WHERE j.id=candidate.id RETURNING j.*`,
      [this.tenantId],
    );
    return result.rows[0];
  }
  /** 先保护版本，再原子清除 chunks 并推进 files 阶段。 */
  async removeChunks(job: CleanupJob): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT id FROM ${this.table('knowledge_bases')} WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
        [this.tenantId, job.knowledge_base_id],
      );
      const documents = await client.query(
        `SELECT * FROM ${this.table('documents')}
        WHERE tenant_id=$1 AND knowledge_base_id=$2 AND id=$3 FOR UPDATE`,
        [this.tenantId, job.knowledge_base_id, job.document_id],
      );
      const document = documents.rows[0];
      if (
        !document ||
        (!document.deleted_at &&
          (document.active_revision_id === job.revision_id ||
            document.latest_revision_id === job.revision_id))
      )
        throw new Error('REVISION_IN_USE');
      const lease = await client.query(
        `SELECT 1 FROM ${this.table('knowledge_cleanup_jobs')}
        WHERE tenant_id=$1 AND id=$2 AND lease_token=$3 AND status='running' AND lease_until>now() FOR UPDATE`,
        [this.tenantId, job.id, job.lease_token],
      );
      if (!lease.rowCount) throw new Error('LEASE_LOST');
      await client.query(
        `DELETE FROM ${this.table('document_chunks')}
        WHERE tenant_id=$1 AND knowledge_base_id=$2 AND document_id=$3 AND revision_id=$4`,
        [this.tenantId, job.knowledge_base_id, job.document_id, job.revision_id],
      );
      await client.query(
        `UPDATE ${this.table('knowledge_cleanup_jobs')} SET stage='files',
        lease_until=now()+interval '2 minutes',updated_at=now() WHERE tenant_id=$1 AND id=$2`,
        [this.tenantId, job.id],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  /** 租约尚有效时完成清理，清空已删除文件的业务引用。 */
  async complete(job: CleanupJob): Promise<void> {
    await this.pool.query(
      `WITH completed AS (
      UPDATE ${this.table('knowledge_cleanup_jobs')} SET status='completed',stage='done',lease_token=NULL,
        lease_until=NULL,error_code=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2
        AND lease_token=$3 AND status='running' AND lease_until>now() RETURNING revision_id),
      cleared AS (UPDATE ${this.table('ingestion_jobs')} j SET staged_path=NULL
        FROM completed WHERE j.tenant_id=$1 AND j.revision_id=completed.revision_id)
      UPDATE ${this.table('document_revisions')} r SET storage_key=NULL,rebuild_snapshot=NULL,
        preview_text='',cleaned_at=now(),status=CASE WHEN status='ready' THEN 'inactive' ELSE status END
        FROM completed WHERE r.tenant_id=$1 AND r.id=completed.revision_id`,
      [this.tenantId, job.id, job.lease_token],
    );
  }
  /** 失败任务保留目标与阶段，指数退避且不影响检索状态。 */
  async fail(job: CleanupJob, code: string): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.table('knowledge_cleanup_jobs')} SET status='failed',lease_token=NULL,
      lease_until=NULL,error_code=$4,next_attempt_at=now()+least(3600,power(2,least(attempts,10))) * interval '1 second',
      updated_at=now() WHERE tenant_id=$1 AND id=$2 AND lease_token=$3`,
      [this.tenantId, job.id, job.lease_token, code],
    );
  }
  /** 文件扫描检查所有租户引用，因为同一服务实例共享物理目录。 */
  async isReferenced(storageKey: string, absolutePath: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT EXISTS(SELECT 1 FROM ${this.table('document_revisions')}
      WHERE storage_key=$1) OR EXISTS(SELECT 1 FROM ${this.table('ingestion_jobs')} WHERE staged_path=$2)
      OR EXISTS(SELECT 1 FROM ${this.table('knowledge_cleanup_jobs')} WHERE status<>'completed'
        AND (storage_key=$1 OR staged_path=$2)) AS referenced`,
      [storageKey, absolutePath],
    );
    return Boolean(result.rows[0]?.referenced);
  }
}
