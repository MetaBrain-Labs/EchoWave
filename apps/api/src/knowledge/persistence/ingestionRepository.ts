/**
 * 知识文档入库持久层。
 *
 * 管理不可变版本输入、任务租约和原子发布，旧 active 版本在修改完成前始终有效。
 *
 * Responsibilities:
 * - 串行分配文档版本并取消被替代任务。
 * - 对阶段、失败、重试和发布执行租约与最新版本校验。
 * - 提交后通知客户端并创建持久清理任务。
 *
 * Notes:
 * - 文件读写由应用服务负责，向量发布仍使用显式 SQL。
 */
import type { PoolClient } from 'pg';
import { toSql } from 'pgvector';
import type { DocumentFormat } from '@echowave/contracts';
import { quoteIdentifier, type DatabasePool } from '../../infrastructure/postgres.ts';
import type { LiveUpdateBroker } from '../../infrastructure/liveUpdateBroker.ts';
import type { ParsedChunkDraft, ParsedDocument } from '../ingestion/documentParser.ts';
import { normalizeParsedDocumentSnapshot } from '../ingestion/parserTypes.ts';
import { RagRepositoryError } from './errors.ts';

/** 失效租约只能收敛自身执行，不能写回已更新文档。 */
export class IngestionLeaseLostError extends Error {
  constructor() {
    super('Ingestion lease or revision is no longer current.');
  }
}
/** worker 所持有的不可变版本和租约快照。 */
export type ClaimedIngestionJob = {
  caseId?: string | null;
  categorySuggestion?: import('@echowave/contracts').ClassificationSuggestion | null;
  id: string;
  tenantId: string;
  knowledgeBaseId: string;
  documentId: string;
  revisionId: string;
  stagedPath: string;
  title: string;
  format: DocumentFormat;
  sizeBytes: number;
  attempts: number;
  leaseToken: string;
  storageKey: string | null;
  rebuildSnapshot: ParsedDocument | null;
  embeddingBindingRevisionId: string | null;
  embeddingModel: string;
};
/** 已持久写入的版本输入；替换操作必须声明预期版本。 */
export type CreateIngestionInput = {
  classificationSourceRevisionId?: string;
  /** 内部案例版本定位，用于事务内幂等创建检索投影。 */
  caseVersionId?: string;
  knowledgeBaseId: string;
  documentId?: string;
  expectedVersion?: number;
  title: string;
  format: DocumentFormat;
  sizeBytes: number;
  sourceSha256: string;
  stagedPath: string;
  storageKey?: string;
  rebuildSnapshot?: ParsedDocument;
  parserVersion: string;
  embeddingModel: string;
  embeddingBindingRevisionId: string | null;
};
/** 全量分块与向量发布输入，任何不完整批次均不得切换 active 指针。 */
type PublishInput = {
  categorySuggestion?: import('@echowave/contracts').ClassificationSuggestion;
  job: ClaimedIngestionJob;
  chunks: ParsedChunkDraft[];
  vectors: number[][];
  previewText: string;
  warnings: string[];
  provider: string;
  embeddingTokens: number;
  estimatedCost: { amount: number; currency: 'CNY' | 'USD' };
  embeddingModel: string;
};
/** 知识版本及任务的事务仓储。 */
export class IngestionRepository {
  constructor(
    private readonly pool: DatabasePool,
    private readonly schema: string,
    private readonly tenantId: string,
    private readonly liveUpdates?: LiveUpdateBroker,
  ) {}
  private table(name: string): string {
    return `${quoteIdentifier(this.schema)}.${quoteIdentifier(name)}`;
  }
  private notify(knowledgeBaseId: string, documentId: string, terminal: boolean): void {
    this.liveUpdates?.publish({
      kind: 'knowledge-document',
      knowledgeBaseId,
      documentId,
      terminal,
    });
  }
  /** 固定按知识库、文档、任务顺序加锁，避免删除与发布形成反向锁依赖。 */
  private async lockDocument(client: PoolClient, knowledgeBaseId: string, documentId: string) {
    const kb = await client.query(
      `SELECT 1 FROM ${this.table('knowledge_bases')}
      WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE`,
      [this.tenantId, knowledgeBaseId],
    );
    if (!kb.rowCount) throw new RagRepositoryError('NOT_FOUND', '知识库不存在。');
    const result = await client.query(
      `SELECT * FROM ${this.table('documents')}
      WHERE tenant_id=$1 AND knowledge_base_id=$2 AND id=$3 AND deleted_at IS NULL FOR UPDATE`,
      [this.tenantId, knowledgeBaseId, documentId],
    );
    if (!result.rows[0]) throw new RagRepositoryError('NOT_FOUND', '文档不存在。');
    return result.rows[0];
  }
  /** 锁定并检查当前执行的租约；超时或被替代的 worker 无权续写。 */
  private async ownedJob(client: PoolClient, job: ClaimedIngestionJob) {
    const document = await this.lockDocument(client, job.knowledgeBaseId, job.documentId);
    if (document.latest_revision_id !== job.revisionId) throw new IngestionLeaseLostError();
    const result = await client.query(
      `SELECT * FROM ${this.table('ingestion_jobs')}
      WHERE tenant_id=$1 AND id=$2 AND document_id=$3 AND revision_id=$4
        AND status='running' AND lease_token=$5 AND lease_until>now() FOR UPDATE`,
      [this.tenantId, job.id, job.documentId, job.revisionId, job.leaseToken],
    );
    if (!result.rowCount) throw new IngestionLeaseLostError();
    return document;
  }
  /** 创建或替换版本；相同文件的新版本允许重复哈希。 */
  async createIngestion(input: CreateIngestionInput) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const kb = await client.query(
        `SELECT 1 FROM ${this.table('knowledge_bases')}
        WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE`,
        [this.tenantId, input.knowledgeBaseId],
      );
      if (!kb.rowCount) throw new RagRepositoryError('NOT_FOUND', '知识库不存在。');
      let documentId = input.documentId;
      if (input.caseVersionId) {
        const linked = await client.query(
          `SELECT v.*,c.document_id,c.version AS current_version,c.status AS case_status
          FROM ${this.table('knowledge_case_versions')} v JOIN ${this.table('knowledge_cases')} c
            ON c.tenant_id=v.tenant_id AND c.id=v.case_id
          WHERE v.tenant_id=$1 AND v.id=$2 AND c.knowledge_base_id=$3 FOR UPDATE OF c,v`,
          [this.tenantId, input.caseVersionId, input.knowledgeBaseId],
        );
        const versionRow = linked.rows[0];
        if (
          !versionRow ||
          versionRow.case_status !== 'published' ||
          versionRow.version !== versionRow.current_version
        )
          throw new RagRepositoryError('CONFLICT', '案例版本已变化。');
        if (versionRow.document_revision_id) {
          const existing = await client.query(
            `SELECT id FROM ${this.table('ingestion_jobs')} WHERE tenant_id=$1 AND revision_id=$2`,
            [this.tenantId, versionRow.document_revision_id],
          );
          await client.query('COMMIT');
          return {
            documentId: versionRow.document_id as string,
            jobId: existing.rows[0].id as string,
          };
        }
        documentId = versionRow.document_id ?? undefined;
      }
      let version = 1;
      if (!documentId) {
        const duplicate = await client.query(
          `SELECT d.id, d.error_code FROM ${this.table('document_revisions')} r
          JOIN ${this.table('documents')} d ON d.tenant_id=r.tenant_id AND d.id=r.document_id
          WHERE r.tenant_id=$1 AND d.knowledge_base_id=$2 AND r.source_sha256=$3 AND d.deleted_at IS NULL
          ORDER BY d.updated_at DESC LIMIT 1 FOR UPDATE OF d`,
          [this.tenantId, input.knowledgeBaseId, input.sourceSha256],
        );
        const stale = duplicate.rows[0];
        if (stale && stale.error_code !== 'EMBEDDING_MODEL_MIGRATION_REQUIRED')
          throw new RagRepositoryError('DUPLICATE_DOCUMENT', '该文件已上传到此知识库。');
        documentId = stale?.id;
      }
      if (documentId) {
        const document = await this.lockDocument(client, input.knowledgeBaseId, documentId);
        if (document.knowledge_case_id && !input.caseVersionId)
          throw new RagRepositoryError('CONFLICT', '请通过案例入口编辑该文档。');
        if (
          !input.caseVersionId &&
          input.documentId &&
          Number(document.version) !== input.expectedVersion
        )
          throw new RagRepositoryError('CONFLICT', '文档版本已变化，请刷新后重试。');
        version = Number(document.version) + 1;
        await client.query(
          `UPDATE ${this.table('ingestion_jobs')} SET status='cancelled',
          lease_token=NULL, lease_until=NULL, updated_at=now()
          WHERE tenant_id=$1 AND document_id=$2 AND status IN ('queued','running','failed')`,
          [this.tenantId, documentId],
        );
        await client.query(
          `UPDATE ${this.table('document_revisions')} SET status='superseded'
          WHERE tenant_id=$1 AND document_id=$2 AND id IS DISTINCT FROM $3 AND status IN ('processing','failed')`,
          [this.tenantId, documentId, document.active_revision_id],
        );
        await client.query(
          `INSERT INTO ${this.table('knowledge_cleanup_jobs')}
          (tenant_id,knowledge_base_id,document_id,revision_id,storage_key,staged_path)
          SELECT r.tenant_id,$3,r.document_id,r.id,r.storage_key,j.staged_path
          FROM ${this.table('document_revisions')} r LEFT JOIN ${this.table('ingestion_jobs')} j
            ON j.tenant_id=r.tenant_id AND j.revision_id=r.id
          WHERE r.tenant_id=$1 AND r.document_id=$2 AND r.id IS DISTINCT FROM $4
          ON CONFLICT DO NOTHING`,
          [this.tenantId, documentId, input.knowledgeBaseId, document.active_revision_id],
        );
      } else {
        const document = await client.query(
          `INSERT INTO ${this.table('documents')}
          (tenant_id,knowledge_base_id,title,format,size_bytes,status)
          VALUES($1,$2,$3,$4,$5,'queued') RETURNING id`,
          [this.tenantId, input.knowledgeBaseId, input.title, input.format, input.sizeBytes],
        );
        documentId = document.rows[0].id as string;
      }
      const revision = await client.query(
        `INSERT INTO ${this.table('document_revisions')}
        (tenant_id,document_id,source_sha256,parser_version,embedding_model,embedding_dimensions,
         embedding_binding_revision_id,status,version,title,format,size_bytes,storage_key,rebuild_snapshot)
        VALUES($1,$2,$3,$4,$5,1024,$6,'processing',$7,$8,$9,$10,$11,$12::jsonb) RETURNING id`,
        [
          this.tenantId,
          documentId,
          input.sourceSha256,
          input.parserVersion,
          input.embeddingModel,
          input.embeddingBindingRevisionId,
          version,
          input.title,
          input.format,
          input.sizeBytes,
          input.storageKey ?? null,
          input.rebuildSnapshot ? JSON.stringify(input.rebuildSnapshot) : null,
        ],
      );
      const revisionId = revision.rows[0].id as string;
      if (input.classificationSourceRevisionId) {
        await client.query(
          `UPDATE ${this.table('document_revisions')} target SET confirmed_category_id=source.confirmed_category_id,sheet_categories=source.sheet_categories,category_suggestion=source.category_suggestion
          FROM ${this.table('document_revisions')} source WHERE target.tenant_id=$1 AND target.id=$2 AND source.tenant_id=target.tenant_id AND source.document_id=target.document_id AND source.id=$3`,
          [this.tenantId, revisionId, input.classificationSourceRevisionId],
        );
      }
      if (input.caseVersionId) {
        await client.query(
          `UPDATE ${this.table('documents')} SET knowledge_case_id=(SELECT case_id FROM ${this.table('knowledge_case_versions')} WHERE tenant_id=$1 AND id=$2) WHERE tenant_id=$1 AND id=$3`,
          [this.tenantId, input.caseVersionId, documentId],
        );
        await client.query(
          `UPDATE ${this.table('knowledge_case_versions')} SET document_revision_id=$3 WHERE tenant_id=$1 AND id=$2`,
          [this.tenantId, input.caseVersionId, revisionId],
        );
        await client.query(
          `UPDATE ${this.table('knowledge_cases')} SET document_id=$3 WHERE tenant_id=$1 AND id=(
          SELECT case_id FROM ${this.table('knowledge_case_versions')} WHERE tenant_id=$1 AND id=$2)`,
          [this.tenantId, input.caseVersionId, documentId],
        );
      }
      const job = await client.query(
        `INSERT INTO ${this.table('ingestion_jobs')}
        (tenant_id,knowledge_base_id,document_id,revision_id,staged_path,status)
        VALUES($1,$2,$3,$4,$5,'queued') RETURNING id`,
        [this.tenantId, input.knowledgeBaseId, documentId, revisionId, input.stagedPath || null],
      );
      await client.query(
        `UPDATE ${this.table('documents')} SET version=$3,latest_revision_id=$4,
        status=CASE WHEN active_revision_id IS NULL THEN 'queued' ELSE 'ready' END,
        progress=0,error_code=NULL,error_message=NULL,error_retryable=NULL,updated_at=now()
        WHERE tenant_id=$1 AND id=$2`,
        [this.tenantId, documentId, version, revisionId],
      );
      await client.query('COMMIT');
      this.notify(input.knowledgeBaseId, documentId, false);
      return { documentId, jobId: job.rows[0].id as string };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  /** 读取改名输入，包括尚未完成的最新文件；返回后仍由 expectedVersion 防覆盖。 */
  async getRevisionSource(knowledgeBaseId: string, documentId: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const document = await this.lockDocument(client, knowledgeBaseId, documentId);
      if (document.knowledge_case_id)
        throw new RagRepositoryError('CONFLICT', '请通过案例入口编辑该文档。');
      const revisions = await client.query(
        `SELECT r.*,j.staged_path FROM ${this.table('document_revisions')} r
        LEFT JOIN ${this.table('ingestion_jobs')} j ON j.tenant_id=r.tenant_id AND j.revision_id=r.id
        WHERE r.tenant_id=$1 AND r.document_id=$2 AND r.id=$3`,
        [this.tenantId, documentId, document.latest_revision_id],
      );
      const revision = revisions.rows[0];
      if (!revision)
        throw new RagRepositoryError('CONFLICT', '文档没有可修改的版本，请替换上传文件。');
      let rebuildSnapshot = revision.rebuild_snapshot as ParsedDocument | null;
      if (!revision.storage_key && !revision.staged_path && !rebuildSnapshot) {
        const chunks = await client.query(
          `SELECT * FROM ${this.table('document_chunks')}
          WHERE tenant_id=$1 AND knowledge_base_id=$2 AND document_id=$3 AND revision_id=$4 ORDER BY chunk_index`,
          [this.tenantId, knowledgeBaseId, documentId, document.active_revision_id],
        );
        if (!chunks.rows.length)
          throw new RagRepositoryError('CONFLICT', '原文件已不可用，请替换上传文件。');
        rebuildSnapshot = {
          previewText: chunks.rows
            .map((row) => row.content)
            .join('\n\n')
            .slice(0, 100_000),
          warnings: revision.warnings,
          chunks: chunks.rows.map((row) => ({
            index: row.chunk_index,
            title: row.title,
            headingPath: row.heading_path,
            content: row.content,
            embeddingText: row.embedding_text,
            contentSha256: row.content_sha256,
            locator: row.locator,
            contentKind: row.content_kind ?? 'legacy',
            titleSource: row.title_source ?? 'legacy',
            partIndex: Number(row.part_index ?? 1),
            partCount: Number(row.part_count ?? 1),
          })),
        };
      }
      await client.query('COMMIT');
      return {
        version: Number(document.version),
        revision,
        rebuildSnapshot: rebuildSnapshot
          ? normalizeParsedDocumentSnapshot(rebuildSnapshot)
          : rebuildSnapshot,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  /** 领取最新有效任务，生成新的租约标识，支持过期接管。 */
  async claimIngestionJob(): Promise<ClaimedIngestionJob | undefined> {
    const result = await this.pool.query(
      `WITH candidate AS (
      SELECT j.id FROM ${this.table('ingestion_jobs')} j
      JOIN ${this.table('documents')} d ON d.tenant_id=j.tenant_id AND d.id=j.document_id
        AND d.knowledge_base_id=j.knowledge_base_id AND d.latest_revision_id=j.revision_id
      JOIN ${this.table('knowledge_bases')} kb ON kb.tenant_id=j.tenant_id AND kb.id=j.knowledge_base_id
      WHERE j.tenant_id=$1 AND d.deleted_at IS NULL AND kb.deleted_at IS NULL
        AND (j.status='queued' OR (j.status='running' AND j.lease_until<now()))
      ORDER BY j.created_at FOR UPDATE OF j SKIP LOCKED LIMIT 1)
      UPDATE ${this.table('ingestion_jobs')} j SET status='running',attempts=j.attempts+1,
        lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes',updated_at=now()
      FROM candidate,${this.table('document_revisions')} r
      WHERE j.id=candidate.id AND r.tenant_id=j.tenant_id AND r.document_id=j.document_id AND r.id=j.revision_id
      RETURNING j.*,r.title,r.format,r.size_bytes,r.storage_key,r.rebuild_snapshot,
        r.embedding_model,r.embedding_binding_revision_id,r.category_suggestion,
        (SELECT knowledge_case_id FROM ${this.table('documents')} d WHERE d.tenant_id=j.tenant_id AND d.id=j.document_id) AS case_id`,
      [this.tenantId],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      caseId: row.case_id ?? null,
      categorySuggestion: row.category_suggestion ?? null,
      id: row.id,
      tenantId: row.tenant_id,
      knowledgeBaseId: row.knowledge_base_id,
      documentId: row.document_id,
      revisionId: row.revision_id,
      stagedPath: row.staged_path ?? '',
      title: row.title,
      format: row.format,
      sizeBytes: Number(row.size_bytes),
      attempts: row.attempts,
      leaseToken: row.lease_token,
      storageKey: row.storage_key,
      rebuildSnapshot: row.rebuild_snapshot,
      embeddingBindingRevisionId: row.embedding_binding_revision_id ?? null,
      embeddingModel: row.embedding_model,
    };
  }
  /** 续租不延长已过期租约，不触及 active 内容或被替代版本状态。 */
  async heartbeat(job: ClaimedIngestionJob): Promise<void> {
    const result = await this.pool.query(
      `UPDATE ${this.table('ingestion_jobs')} j
      SET lease_until=now()+interval '2 minutes'
      FROM ${this.table('documents')} d,${this.table('knowledge_bases')} kb
      WHERE j.tenant_id=$1 AND j.id=$2 AND j.lease_token=$3 AND j.status='running' AND j.lease_until>now()
        AND d.tenant_id=j.tenant_id AND d.id=j.document_id AND d.latest_revision_id=j.revision_id AND d.deleted_at IS NULL
        AND kb.tenant_id=j.tenant_id AND kb.id=j.knowledge_base_id AND kb.deleted_at IS NULL`,
      [this.tenantId, job.id, job.leaseToken],
    );
    if (!result.rowCount) throw new IngestionLeaseLostError();
  }
  /** 在事务中推进最新任务；修改期间保持旧版本 ready。 */
  async setJobStage(
    job: ClaimedIngestionJob,
    stage: string,
    status: string,
    progress = 0,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.ownedJob(client, job);
      await client.query(
        `UPDATE ${this.table('ingestion_jobs')} SET stage=$3,progress=$4,
        lease_until=now()+interval '2 minutes',updated_at=now() WHERE tenant_id=$1 AND id=$2`,
        [this.tenantId, job.id, stage, progress],
      );
      await client.query(
        `UPDATE ${this.table('documents')} SET
        status=CASE WHEN active_revision_id IS NULL THEN $3 ELSE 'ready' END,progress=$4,updated_at=now()
        WHERE tenant_id=$1 AND id=$2`,
        [this.tenantId, job.documentId, status, progress],
      );
      await client.query('COMMIT');
      this.notify(job.knowledgeBaseId, job.documentId, false);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  /** 在租约边界内保存一次建议，向量阶段重试不得重复发起分类模型调用。 */
  async saveIngestionSuggestion(
    job: ClaimedIngestionJob,
    suggestion: import('@echowave/contracts').ClassificationSuggestion,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.ownedJob(client, job);
      await client.query(
        `UPDATE ${this.table('document_revisions')} SET category_suggestion=$3::jsonb WHERE tenant_id=$1 AND id=$2 AND category_suggestion IS NULL`,
        [this.tenantId, job.revisionId, JSON.stringify(suggestion)],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  /** 全部向量准备完成后原子发布，不让未确认建议覆盖人工分类。 */
  async publishRevision(input: PublishInput): Promise<void> {
    if (
      input.embeddingModel !== input.job.embeddingModel ||
      !input.chunks.length ||
      input.chunks.length !== input.vectors.length ||
      input.vectors.some(
        (vector) => vector.length !== 1024 || vector.some((value) => !Number.isFinite(value)),
      )
    )
      throw new Error('Invalid chunk/vector batch.');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const document = await this.ownedJob(client, input.job);
      await client.query(
        `DELETE FROM ${this.table('document_chunks')} WHERE tenant_id=$1 AND revision_id=$2`,
        [this.tenantId, input.job.revisionId],
      );
      for (let index = 0; index < input.chunks.length; index += 1) {
        const chunk = input.chunks[index]!;
        const vector = input.vectors[index]!;
        await client.query(
          `INSERT INTO ${this.table('document_chunks')}
          (tenant_id,knowledge_base_id,document_id,revision_id,chunk_index,title,heading_path,content,
           embedding_text,content_sha256,locator,content_kind,title_source,part_index,part_count,
           embedding_model,embedding)
          VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16,$17::vector)`,
          [
            this.tenantId,
            input.job.knowledgeBaseId,
            input.job.documentId,
            input.job.revisionId,
            chunk.index,
            chunk.title,
            JSON.stringify(chunk.headingPath),
            chunk.content,
            chunk.embeddingText,
            chunk.contentSha256,
            JSON.stringify(chunk.locator),
            chunk.contentKind,
            chunk.titleSource,
            chunk.partIndex,
            chunk.partCount,
            input.embeddingModel,
            toSql(vector),
          ],
        );
      }
      await client.query(
        `UPDATE ${this.table('document_revisions')} SET status='ready',preview_text=$3,
        warnings=$4::jsonb,published_at=now(),embedding_provider=$5,embedding_tokens=$6,
        embedding_cost_amount=$7,embedding_cost_currency=$8,category_suggestion=coalesce($9::jsonb,category_suggestion) WHERE tenant_id=$1 AND id=$2`,
        [
          this.tenantId,
          input.job.revisionId,
          input.previewText,
          JSON.stringify(input.warnings),
          input.provider,
          input.embeddingTokens,
          input.estimatedCost.amount,
          input.estimatedCost.currency,
          input.categorySuggestion ? JSON.stringify(input.categorySuggestion) : null,
        ],
      );
      await client.query(
        `UPDATE ${this.table('documents')} SET active_revision_id=$3,status='ready',
        title=$4,format=$5,size_bytes=$6,progress=100,error_code=NULL,error_message=NULL,
        error_retryable=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2`,
        [
          this.tenantId,
          input.job.documentId,
          input.job.revisionId,
          input.job.title,
          input.job.format,
          input.job.sizeBytes,
        ],
      );
      await client.query(
        `UPDATE ${this.table('ingestion_jobs')} SET status='completed',progress=100,
        stage='cleanup',lease_until=NULL,lease_token=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2`,
        [this.tenantId, input.job.id],
      );
      if (document.active_revision_id && document.active_revision_id !== input.job.revisionId) {
        await client.query(
          `UPDATE ${this.table('document_revisions')} SET status='inactive'
          WHERE tenant_id=$1 AND id=$2`,
          [this.tenantId, document.active_revision_id],
        );
        await client.query(
          `INSERT INTO ${this.table('knowledge_cleanup_jobs')}
          (tenant_id,knowledge_base_id,document_id,revision_id,storage_key,staged_path)
          SELECT r.tenant_id,$3,r.document_id,r.id,r.storage_key,j.staged_path
          FROM ${this.table('document_revisions')} r LEFT JOIN ${this.table('ingestion_jobs')} j
            ON j.tenant_id=r.tenant_id AND j.revision_id=r.id WHERE r.tenant_id=$1 AND r.id=$2
          ON CONFLICT DO NOTHING`,
          [this.tenantId, document.active_revision_id, input.job.knowledgeBaseId],
        );
      }
      await client.query(
        `UPDATE ${this.table('knowledge_bases')} SET content_version=content_version+1,
        updated_at=now() WHERE tenant_id=$1 AND id=$2`,
        [this.tenantId, input.job.knowledgeBaseId],
      );
      await client.query('COMMIT');
      this.notify(input.job.knowledgeBaseId, input.job.documentId, true);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  /** 仅保存仍持有租约的最新失败任务；旧 active 版本不受影响。 */
  async failJob(
    job: ClaimedIngestionJob,
    code: string,
    message: string,
    retryable: boolean,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.ownedJob(client, job);
      await client.query(
        `UPDATE ${this.table('ingestion_jobs')} SET status='failed',lease_until=NULL,
        lease_token=NULL,error_code=$3,error_message=$4,error_retryable=$5,updated_at=now()
        WHERE tenant_id=$1 AND id=$2`,
        [this.tenantId, job.id, code, message, retryable],
      );
      await client.query(
        `UPDATE ${this.table('document_revisions')} SET status='failed' WHERE tenant_id=$1 AND id=$2`,
        [this.tenantId, job.revisionId],
      );
      await client.query(
        `UPDATE ${this.table('documents')} SET
        status=CASE WHEN active_revision_id IS NULL THEN 'failed' ELSE 'ready' END,
        error_code=$3,error_message=$4,error_retryable=$5,updated_at=now() WHERE tenant_id=$1 AND id=$2`,
        [this.tenantId, job.documentId, code, message, retryable],
      );
      await client.query('COMMIT');
      this.notify(job.knowledgeBaseId, job.documentId, true);
    } catch (error) {
      await client.query('ROLLBACK');
      if (
        error instanceof IngestionLeaseLostError ||
        (error instanceof RagRepositoryError && error.code === 'NOT_FOUND')
      )
        return;
      throw error;
    } finally {
      client.release();
    }
  }
  /** 仅重新排队最新、有原文件或固化快照且允许重试的失败任务。 */
  async retryDocument(
    knowledgeBaseId: string,
    documentId: string,
    expectedCase?: { id: string; version: number },
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (expectedCase) {
        const current = await client.query(
          `SELECT c.id FROM ${this.table('knowledge_cases')} c
          JOIN ${this.table('knowledge_case_versions')} v ON v.tenant_id=c.tenant_id AND v.case_id=c.id AND v.version=c.version
          JOIN ${this.table('documents')} d ON d.tenant_id=c.tenant_id AND d.id=c.document_id AND d.latest_revision_id=v.document_revision_id
          WHERE c.tenant_id=$1 AND c.id=$2 AND c.version=$3 AND c.status='published' AND c.knowledge_base_id=$4 AND c.document_id=$5 FOR UPDATE OF c,v`,
          [this.tenantId, expectedCase.id, expectedCase.version, knowledgeBaseId, documentId],
        );
        if (!current.rowCount)
          throw new RagRepositoryError('CONFLICT', '案例版本已变化，请读取最新状态后重试。');
      }
      const document = await this.lockDocument(client, knowledgeBaseId, documentId);
      const result = await client.query(
        `UPDATE ${this.table('ingestion_jobs')} j SET status='queued',progress=0,
        stage='validate',error_code=NULL,error_message=NULL,error_retryable=NULL,updated_at=now()
        FROM ${this.table('document_revisions')} r
        WHERE j.tenant_id=$1 AND j.document_id=$2 AND j.revision_id=$3 AND j.status='failed'
          AND j.error_retryable=true AND r.tenant_id=j.tenant_id AND r.id=j.revision_id
          AND (j.staged_path IS NOT NULL OR r.storage_key IS NOT NULL OR r.rebuild_snapshot IS NOT NULL)
        RETURNING j.id`,
        [this.tenantId, documentId, document.latest_revision_id],
      );
      if (!result.rowCount)
        throw new RagRepositoryError('CONFLICT', '该失败不能直接重试，请替换上传文件。');
      await client.query(
        `UPDATE ${this.table('document_revisions')} SET status='processing' WHERE tenant_id=$1 AND id=$2`,
        [this.tenantId, document.latest_revision_id],
      );
      await client.query(
        `UPDATE ${this.table('documents')} SET
        status=CASE WHEN active_revision_id IS NULL THEN 'queued' ELSE 'ready' END,progress=0,
        error_code=NULL,error_message=NULL,error_retryable=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2`,
        [this.tenantId, documentId],
      );
      await client.query('COMMIT');
      this.notify(knowledgeBaseId, documentId, false);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
