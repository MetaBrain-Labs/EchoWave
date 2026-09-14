/**
 * 案例收集生命周期仓储。
 *
 * 保存规则、人工修正、案例快照与持久任务，保证租户隔离和审核版本校验。
 *
 * Responsibilities:
 * - 读取成功分析的固定确认正文与角色证据。
 * - 原子保存候选、版本和审核状态。
 * - 领取、续租和恢复后台收集任务。
 *
 * Notes:
 * - 检索文档发布仍由知识入库仓储负责。
 */
import { CollectionFolderRepository } from './folderRepository.ts';
import type { FrozenCollectionRule, CollectionRule } from '@echowave/contracts';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  AnalysisCorrectionSchema,
  CollectionRuleSchema,
  CollectionRuleInputSchema,
  KnowledgeCaseSchema,
  CollectionRunSchema,
  CaseTurnSchema,
  CaseContentSchema,
  type AnalysisCorrectionInput,
  type CaseContent,
  type CollectionRuleInput,
  type CollectionHistoryRequest,
  type KnowledgeCase,
  type CaseTurn,
} from '@echowave/contracts';
import { quoteIdentifier, type DatabasePool } from '../../infrastructure/postgres.ts';
import { RagRepositoryError } from '../persistence/errors.ts';
import {
  caseMediaKey,
  collectionDedupeKey,
  contentForSource,
  validateCaseTurns,
  type CollectionSource,
} from './policy.ts';

/** 领取后携带独立租约，失效 Worker 无权写回。 */
export type CollectionTask = {
  id: string;
  kind: 'source' | 'projection' | 'media' | 'cleanup';
  payload: {
    jobId?: string;
    tagId?: string;
    correctionId?: string | null;
    rules?: Array<CollectionRuleInput | FrozenCollectionRule | CollectionRule>;
    caseId?: string;
    version?: number;
  };
  leaseToken: string;
};
/** 当前租户下的案例收集仓储。 */
export class CollectionRepository {
  readonly folders: CollectionFolderRepository;
  constructor(
    private readonly pool: DatabasePool,
    private readonly schema: string,
    private readonly tenantId: string,
  ) {
    this.folders = new CollectionFolderRepository(pool, schema, tenantId);
  }
  private table(name: string) {
    return `${quoteIdentifier(this.schema)}.${quoteIdentifier(name)}`;
  }
  /** 固定业务错误不会携带 SQL 或模型正文。 */
  private conflict(message = '内容版本已变化，请刷新后重试。'): never {
    throw new RagRepositoryError('CONFLICT', message);
  }
  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  private async group(client: DatabasePool | PoolClient, id: string) {
    const r = await client.query(
      `SELECT 1 FROM ${this.table('groups')} WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL`,
      [this.tenantId, id],
    );
    if (!r.rowCount) throw new RagRepositoryError('NOT_FOUND', '分组不存在。');
  }
  private async knowledge(client: DatabasePool | PoolClient, id: string, lock = false) {
    const r = await client.query(
      `SELECT 1 FROM ${this.table('knowledge_bases')} WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL ${lock ? 'FOR UPDATE' : ''}`,
      [this.tenantId, id],
    );
    if (!r.rowCount) throw new RagRepositoryError('NOT_FOUND', '知识库不存在。');
  }
  /** 查询完整规则，包括停用规则。 */
  async listRules(groupId: string) {
    await this.group(this.pool, groupId);
    const r = await this.pool.query(
      `SELECT * FROM ${this.table('collection_rules')} WHERE tenant_id=$1 AND group_id=$2 ORDER BY created_at`,
      [this.tenantId, groupId],
    );
    return {
      items: r.rows.map((row) =>
        CollectionRuleSchema.parse({
          ...row.data,
          id: row.id,
          groupId,
          version: row.version,
          updatedAt: new Date(row.updated_at).toISOString(),
        }),
      ),
    };
  }
  /** 创建或修改规则时检查目标库与数据源的当前租户归属。 */
  async saveRule(
    groupId: string,
    input: CollectionRuleInput,
    id?: string,
    expectedVersion?: number,
  ) {
    const data = CollectionRuleInputSchema.parse(input);
    const ruleId = id ?? randomUUID();
    await this.transaction(async (client) => {
      await this.group(client, groupId);
      await this.knowledge(client, data.knowledgeBaseId, true);
      if (data.filters.dataSourceIds.length) {
        const sources = await client.query(
          `SELECT id FROM ${this.table('data_sources')} WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND deleted_at IS NULL`,
          [this.tenantId, data.filters.dataSourceIds],
        );
        if (sources.rowCount !== new Set(data.filters.dataSourceIds).size)
          this.conflict('所选数据源不存在。');
      }
      if (id) {
        const r = await client.query(
          `UPDATE ${this.table('collection_rules')} SET data=$5::jsonb, knowledge_base_id=$6,version=version+1,updated_at=now() WHERE tenant_id=$1 AND group_id=$2 AND id=$3 AND version=$4 RETURNING id`,
          [this.tenantId, groupId, id, expectedVersion, JSON.stringify(data), data.knowledgeBaseId],
        );
        if (!r.rowCount) this.conflict();
      } else
        await client.query(
          `INSERT INTO ${this.table('collection_rules')}(id,tenant_id,group_id,knowledge_base_id,data) VALUES($1,$2,$3,$4,$5::jsonb)`,
          [ruleId, this.tenantId, groupId, data.knowledgeBaseId, JSON.stringify(data)],
        );
    });
    return (await this.listRules(groupId)).items.find((r) => r.id === ruleId)!;
  }
  /** 按标签保存修正序列；原分析保持不可变。 */
  async saveCorrection(jobId: string, tagId: string, input: AnalysisCorrectionInput) {
    await this.transaction(async (client) => {
      const tag = await client.query(
        `SELECT t.id FROM ${this.table('business_analysis_tags')} t JOIN ${this.table('audio_business_analysis_jobs')} j ON j.tenant_id=t.tenant_id AND j.id=t.job_id WHERE t.tenant_id=$1 AND t.job_id=$2 AND t.id=$3 AND j.status='ready' FOR UPDATE OF t`,
        [this.tenantId, jobId, tagId],
      );
      if (!tag.rowCount) throw new RagRepositoryError('NOT_FOUND', '分析标签不存在。');
      const previous = await client.query(
        `SELECT coalesce(max(version),0)::int AS version FROM ${this.table('analysis_corrections')} WHERE tenant_id=$1 AND job_id=$2 AND tag_id=$3`,
        [this.tenantId, jobId, tagId],
      );
      if (previous.rows[0].version !== input.expectedVersion) this.conflict();
      const { expectedVersion, ...data } = input;
      await client.query(
        `INSERT INTO ${this.table('analysis_corrections')}(tenant_id,job_id,tag_id,version,data) VALUES($1,$2,$3,$4,$5::jsonb)`,
        [this.tenantId, jobId, tagId, expectedVersion + 1, JSON.stringify(data)],
      );
    });
    return (await this.listCorrections(jobId, tagId)).items[0]!;
  }
  /** 返回完整人工修正历史，最新版本排在前面。 */
  async listCorrections(jobId: string, tagId: string) {
    const sources = await this.sources(jobId);
    if (!sources.some((s) => s.tagId === tagId))
      throw new RagRepositoryError('NOT_FOUND', '分析标签不存在。');
    const r = await this.pool.query(
      `SELECT * FROM ${this.table('analysis_corrections')} WHERE tenant_id=$1 AND job_id=$2 AND tag_id=$3 ORDER BY version DESC`,
      [this.tenantId, jobId, tagId],
    );
    return {
      items: r.rows.map((row) =>
        AnalysisCorrectionSchema.parse({
          ...row.data,
          id: row.id,
          jobId,
          tagId,
          version: row.version,
          createdAt: new Date(row.created_at).toISOString(),
        }),
      ),
    };
  }
  /** 来源总是恢复任务实际使用的确认版本，不能读取今天的新转写替代历史。 */
  async sources(
    jobId: string,
    correctionId?: string | null,
    includeDialogue = false,
  ): Promise<CollectionSource[]> {
    const jobs = await this.pool.query(
      `SELECT j.*,af.data_source_id FROM ${this.table('audio_business_analysis_jobs')} j JOIN ${this.table('audio_files')} af ON af.tenant_id=j.tenant_id AND af.id=j.audio_file_id WHERE j.tenant_id=$1 AND j.id=$2 AND j.status='ready' AND af.deleted_at IS NULL`,
      [this.tenantId, jobId],
    );
    const job = jobs.rows[0];
    if (!job) throw new RagRepositoryError('NOT_FOUND', '成功分析不存在或源记录已删除。');
    const segments = await this.pool.query(
      `SELECT c.*,rr.role_kind FROM ${this.table('transcript_confirmation_segments')} c LEFT JOIN ${this.table('speaker_role_results')} rr ON rr.tenant_id=c.tenant_id AND rr.job_id=$3 AND rr.speaker_key=c.speaker_key WHERE c.tenant_id=$1 AND c.transcript_confirmation_id=$2 ORDER BY c.start_ms,c.end_ms,c.confirmed_segment_id`,
      [this.tenantId, job.transcript_confirmation_id, job.role_job_id],
    );
    const availableTurns = segments.rows.map((row) =>
      CaseTurnSchema.parse({
        segmentId: row.confirmed_segment_id,
        speakerLabel: row.speaker_key,
        role: ['sales', 'customer'].includes(row.role_kind) ? row.role_kind : 'unknown',
        text: row.text,
        startMs: Number(row.start_ms),
        endMs: Number(row.end_ms),
      }),
    );
    const tags = await this.pool.query(
      `SELECT t.*,array_agg(m.confirmed_segment_id) FILTER(WHERE m.confirmed_segment_id IS NOT NULL) AS segment_ids FROM ${this.table('business_analysis_tags')} t LEFT JOIN ${this.table('business_analysis_tag_segments')} m ON m.tenant_id=t.tenant_id AND m.job_id=t.job_id AND m.tag_id=t.id WHERE t.tenant_id=$1 AND t.job_id=$2 GROUP BY t.id ORDER BY t.tag_index`,
      [this.tenantId, jobId],
    );
    const base = tags.rows.map((t) => ({
      jobId,
      groupId: job.group_id as string,
      audioFileId: job.audio_file_id as string,
      dataSourceId: job.data_source_id as string,
      analysisRevisionId: job.analysis_revision_id as string,
      confirmationVersion: Number(job.confirmation_version),
      tagId: t.id as string,
      correctionId: null,
      category: t.category as string,
      customLabel: t.custom_label as string | null,
      title: t.title as string,
      reason: [t.summary, ...t.details].join('\n'),
      confidence: Number(t.confidence),
      suggestedReply: '',
      segmentIds: (t.segment_ids ?? []) as string[],
      availableTurns,
    }));
    if (!correctionId) {
      if (includeDialogue && !base.length && availableTurns.length)
        return [
          {
            jobId,
            groupId: job.group_id,
            audioFileId: job.audio_file_id,
            dataSourceId: job.data_source_id,
            analysisRevisionId: job.analysis_revision_id,
            confirmationVersion: Number(job.confirmation_version),
            tagId: null,
            correctionId: null,
            category: 'custom',
            customLabel: null,
            title: 'Dialogue',
            reason: 'Original dialogue selected by the user.',
            confidence: 0,
            suggestedReply: '',
            segmentIds: availableTurns.map((t) => t.segmentId),
            availableTurns,
          },
        ];
      return base;
    }
    const correction = await this.pool.query(
      `SELECT * FROM ${this.table('analysis_corrections')} WHERE tenant_id=$1 AND job_id=$2 AND id=$3`,
      [this.tenantId, jobId, correctionId],
    );
    const c = correction.rows[0];
    const original = base.find((t) => t.tagId === c?.tag_id);
    if (!c || !original) throw new RagRepositoryError('NOT_FOUND', '人工纠正不存在。');
    return [
      {
        ...original,
        originalJudgment: {
          category: original.category as
            'strength' | 'improvement' | 'risk' | 'suggestion' | 'custom',
          customLabel: original.customLabel,
          reason: original.reason,
          confidence: original.confidence,
        },
        correctionSnapshot: { version: c.version, ...c.data },
        correctionId: c.id,
        category: 'correction',
        customLabel: c.data.customLabel,
        reason: c.data.reason,
        suggestedReply: c.data.suggestedReply,
      },
    ];
  }
  /** 幂等保存案例；已有拒绝、精选和人工版本均不更新。 */
  async collect(
    source: CollectionSource,
    rule: CollectionRuleInput,
    origin: 'automatic' | 'manual',
    content?: CaseContent,
    identity?: FrozenCollectionRule,
  ) {
    const body = CaseContentSchema.parse(content ?? contentForSource(source, rule.category));
    try {
      validateCaseTurns(body, source.availableTurns);
    } catch {
      this.conflict('案例轮次必须对应原始对话，正文修改请使用补充或建议话术。');
    }
    if (body.category.id !== rule.category.id) this.conflict('案例类别与收集类别不一致。');
    const key = collectionDedupeKey(source, rule.category.id);
    const id = await this.transaction(async (client) => {
      await this.knowledge(client, rule.knowledgeBaseId, true);
      const snapshot = {
        audioFileId: source.audioFileId,
        jobId: source.jobId,
        tagId: source.tagId,
        correctionId: source.correctionId,
        analysisRevisionId: source.analysisRevisionId,
        confirmationVersion: source.confirmationVersion,
        collectionMode: origin === 'manual' ? 'manual' : rule.mode,
        originalJudgment:
          source.originalJudgment ??
          (source.tagId
            ? {
                category: source.category,
                customLabel: source.customLabel,
                reason: source.reason,
                confidence: source.confidence,
              }
            : undefined),
        correctionSnapshot: source.correctionSnapshot,
      };
      const r = await client.query(
        `INSERT INTO ${this.table('knowledge_cases')}(tenant_id,group_id,knowledge_base_id,dedupe_key,status,origin,source,available_turns) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb) ON CONFLICT(tenant_id,knowledge_base_id,dedupe_key) DO NOTHING RETURNING id`,
        [
          this.tenantId,
          source.groupId,
          rule.knowledgeBaseId,
          key,
          rule.mode === 'direct' ? 'published' : 'candidate',
          origin,
          JSON.stringify(snapshot),
          JSON.stringify(source.availableTurns),
        ],
      );
      if (r.rows[0]) {
        const caseId = r.rows[0].id as string;
        await client.query(
          `INSERT INTO ${this.table('knowledge_case_versions')}(tenant_id,case_id,version,content) VALUES($1,$2,1,$3::jsonb)`,
          [this.tenantId, caseId, JSON.stringify(body)],
        );
        if (identity) await this.folders.link(client, caseId, identity);
        return caseId;
      }
      const existing = await client.query(
        `SELECT id FROM ${this.table('knowledge_cases')} WHERE tenant_id=$1 AND knowledge_base_id=$2 AND dedupe_key=$3`,
        [this.tenantId, rule.knowledgeBaseId, key],
      );
      const caseId = existing.rows[0].id as string;
      if (identity) await this.folders.link(client, caseId, identity);
      return caseId;
    });
    return this.getCase(id);
  }
  /** 恢复正文、来源更新标记、检索任务和每轮音频状态。 */
  async getCase(id: string): Promise<KnowledgeCase> {
    const r = await this.pool.query(
      `SELECT c.*,v.content,r.status AS revision_status,j.error_message AS publication_message,j.error_retryable AS publication_retryable,
      EXISTS(SELECT 1 FROM ${this.table('audio_business_analysis_jobs')} newer WHERE newer.tenant_id=c.tenant_id AND newer.group_id=c.group_id AND newer.audio_file_id=(c.source->>'audioFileId')::uuid AND newer.status='ready' AND newer.id<>(c.source->>'jobId')::uuid AND newer.published_at>original.published_at) AS source_updated
      FROM ${this.table('knowledge_cases')} c JOIN ${this.table('knowledge_case_versions')} v ON v.tenant_id=c.tenant_id AND v.case_id=c.id AND v.version=c.version
      JOIN ${this.table('knowledge_bases')} kb ON kb.tenant_id=c.tenant_id AND kb.id=c.knowledge_base_id AND kb.deleted_at IS NULL
      LEFT JOIN ${this.table('document_revisions')} r ON r.tenant_id=v.tenant_id AND r.id=v.document_revision_id
      LEFT JOIN ${this.table('ingestion_jobs')} j ON j.tenant_id=r.tenant_id AND j.revision_id=r.id
      LEFT JOIN ${this.table('audio_business_analysis_jobs')} original ON original.tenant_id=c.tenant_id AND original.id=(c.source->>'jobId')::uuid
      WHERE c.tenant_id=$1 AND c.id=$2`,
      [this.tenantId, id],
    );
    const row = r.rows[0];
    if (!row) throw new RagRepositoryError('NOT_FOUND', '案例不存在。');
    const media = await this.pool.query(
      `SELECT * FROM ${this.table('knowledge_case_media')} WHERE tenant_id=$1 AND case_id=$2 AND version=$3`,
      [this.tenantId, id, row.version],
    );
    const mediaById = new Map(media.rows.map((m) => [m.segment_id, m]));
    const tasks = await this.pool.query(
      `SELECT error_message FROM ${this.table('collection_tasks')} WHERE tenant_id=$1 AND kind='projection' AND dedupe_key=$2 AND status='failed'`,
      [this.tenantId, `${id}:${row.version}`],
    );
    const requested = row.status === 'published';
    return KnowledgeCaseSchema.parse({
      id,
      groupId: row.group_id,
      knowledgeBaseId: row.knowledge_base_id,
      version: row.version,
      status: row.status,
      origin: row.origin,
      source: row.source,
      sourceUpdated: row.source_updated,
      content: row.content,
      availableTurns: row.available_turns,
      documentId: row.document_id,
      publication: !requested
        ? 'not_requested'
        : row.revision_status === 'ready'
          ? 'ready'
          : row.revision_status === 'failed' || tasks.rowCount
            ? 'failed'
            : 'pending',
      publicationRetryable: !!tasks.rowCount || row.publication_retryable === true,
      publicationMessage: row.publication_message ?? tasks.rows[0]?.error_message ?? null,
      media: row.content.turns.map((t: CaseTurn) => {
        const m = mediaById.get(t.segmentId);
        return {
          segmentId: t.segmentId,
          status: m?.status ?? 'pending',
          message: m?.message ?? null,
          url:
            requested && m?.status === 'ready'
              ? `/api/knowledge-cases/${id}/media/${t.segmentId}?version=${row.version}`
              : null,
        };
      }),
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    });
  }
  /** 列表保留拒绝和撤回状态以供审核追溯，删除记录不再展示。 */
  async listCases(knowledgeBaseId: string) {
    await this.knowledge(this.pool, knowledgeBaseId);
    const r = await this.pool.query(
      `SELECT id FROM ${this.table('knowledge_cases')} WHERE tenant_id=$1 AND knowledge_base_id=$2 AND status<>'deleted' ORDER BY updated_at DESC`,
      [this.tenantId, knowledgeBaseId],
    );
    return { items: await Promise.all(r.rows.map((row) => this.getCase(row.id))) };
  }
  /** 编辑只新增版本；被拒绝记录需手动收集新来源，重试不能复活。 */
  async updateCase(id: string, expectedVersion: number, content: CaseContent) {
    const current = await this.getCase(id);
    try {
      validateCaseTurns(content, current.availableTurns);
    } catch {
      this.conflict('所选轮次与原始对话不一致。');
    }
    await this.transaction(async (client) => {
      await this.knowledge(client, current.knowledgeBaseId, true);
      const r = await client.query(
        `UPDATE ${this.table('knowledge_cases')} SET version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND version=$3 AND status IN ('candidate','published') RETURNING version`,
        [this.tenantId, id, expectedVersion],
      );
      if (!r.rowCount) this.conflict();
      await client.query(
        `INSERT INTO ${this.table('knowledge_case_versions')}(tenant_id,case_id,version,content) VALUES($1,$2,$3,$4::jsonb)`,
        [this.tenantId, id, r.rows[0].version, JSON.stringify(content)],
      );
    });
    return this.getCase(id);
  }
  /** 审核状态转换必须显式进行，并锁定同一知识库防止删除竞态。 */
  async action(
    id: string,
    expectedVersion: number,
    action: 'publish' | 'reject' | 'withdraw' | 'delete',
  ) {
    const current = await this.getCase(id);
    const allowed =
      action === 'publish' || action === 'reject'
        ? ['candidate']
        : action === 'withdraw'
          ? ['published']
          : ['candidate', 'published', 'rejected', 'withdrawn'];
    const status = {
      publish: 'published',
      reject: 'rejected',
      withdraw: 'withdrawn',
      delete: 'deleted',
    }[action];
    await this.transaction(async (client) => {
      await this.knowledge(client, current.knowledgeBaseId, true);
      const changed = await client.query(
        `UPDATE ${this.table('knowledge_cases')} SET status=$4,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND version=$3 AND status=ANY($5::text[]) RETURNING version`,
        [this.tenantId, id, expectedVersion, status, allowed],
      );
      if (!changed.rowCount) this.conflict('案例状态或版本已变化，请刷新后重试。');
      await client.query(
        `INSERT INTO ${this.table('knowledge_case_versions')}(tenant_id,case_id,version,content) VALUES($1,$2,$3,$4::jsonb)`,
        [this.tenantId, id, changed.rows[0].version, JSON.stringify(current.content)],
      );
      if ((action === 'withdraw' || action === 'delete') && current.documentId) {
        await client.query(
          `UPDATE ${this.table('documents')} SET deleted_at=now(),status='deleted',updated_at=now() WHERE tenant_id=$1 AND id=$2`,
          [this.tenantId, current.documentId],
        );
        await client.query(
          `UPDATE ${this.table('ingestion_jobs')} SET status='cancelled',lease_token=NULL,lease_until=NULL WHERE tenant_id=$1 AND document_id=$2 AND status IN ('queued','running','failed')`,
          [this.tenantId, current.documentId],
        );
        await client.query(
          `INSERT INTO ${this.table('knowledge_cleanup_jobs')}(tenant_id,knowledge_base_id,document_id,revision_id,storage_key,staged_path) SELECT r.tenant_id,$3,r.document_id,r.id,r.storage_key,j.staged_path FROM ${this.table('document_revisions')} r LEFT JOIN ${this.table('ingestion_jobs')} j ON j.tenant_id=r.tenant_id AND j.revision_id=r.id WHERE r.tenant_id=$1 AND r.document_id=$2 ON CONFLICT DO NOTHING`,
          [this.tenantId, current.documentId, current.knowledgeBaseId],
        );
        await client.query(
          `UPDATE ${this.table('knowledge_bases')} SET content_version=content_version+1 WHERE tenant_id=$1 AND id=$2`,
          [this.tenantId, current.knowledgeBaseId],
        );
      }
    });
    return this.getCase(id);
  }
  /** 找到范围内每份音频最新成功任务及其最新有效人工纠正。 */
  async historySources(groupId: string, range: CollectionHistoryRequest) {
    await this.group(this.pool, groupId);
    const r = await this.pool.query(
      `SELECT DISTINCT ON(audio_file_id) id FROM ${this.table('audio_business_analysis_jobs')} WHERE tenant_id=$1 AND group_id=$2 AND status='ready' AND published_at BETWEEN $3 AND $4 ORDER BY audio_file_id,published_at DESC,id DESC`,
      [this.tenantId, groupId, range.from, range.to],
    );
    const sources: CollectionSource[] = [];
    for (const row of r.rows) {
      sources.push(...(await this.sources(row.id)));
      const corrections = await this.pool.query(
        `SELECT DISTINCT ON(tag_id) id FROM ${this.table('analysis_corrections')} WHERE tenant_id=$1 AND job_id=$2 ORDER BY tag_id,version DESC`,
        [this.tenantId, row.id],
      );
      for (const c of corrections.rows) sources.push(...(await this.sources(row.id, c.id)));
    }
    return sources;
  }
  /** 历史补收冻结规则和匹配来源，领取时仍走统一幂等收集。 */
  async startHistory(groupId: string, rule: CollectionRule, sources: CollectionSource[]) {
    const runId = randomUUID();
    await this.transaction(async (client) => {
      await this.group(client, groupId);
      await client.query(
        `INSERT INTO ${this.table('collection_runs')}(id,tenant_id,group_id) VALUES($1,$2,$3)`,
        [runId, this.tenantId, groupId],
      );
      for (const s of sources)
        await client.query(
          `INSERT INTO ${this.table('collection_tasks')}(tenant_id,kind,dedupe_key,payload,run_id) VALUES($1,'source',$2,$3::jsonb,$4)`,
          [
            this.tenantId,
            `${runId}:${s.correctionId ?? s.tagId}`,
            JSON.stringify({
              jobId: s.jobId,
              correctionId: s.correctionId,
              tagId: s.tagId,
              rules: [
                {
                  id: rule.id,
                  version: rule.version,
                  input: {
                    name: rule.name,
                    enabled: rule.enabled,
                    mode: rule.mode,
                    category: rule.category,
                    knowledgeBaseId: rule.knowledgeBaseId,
                    filters: rule.filters,
                  },
                },
              ],
            }),
            runId,
          ],
        );
    });
    return (await this.listRuns(groupId)).items.find((r) => r.id === runId)!;
  }
  /** 按权威任务状态聚合补收进度，空任务立即完成。 */
  async listRuns(groupId: string) {
    await this.group(this.pool, groupId);
    const r = await this.pool.query(
      `SELECT r.*,count(t.id)::int AS total,count(t.id) FILTER(WHERE t.status='completed')::int AS completed,count(t.id) FILTER(WHERE t.status='failed')::int AS failed,count(t.id) FILTER(WHERE t.status='running')::int AS running,max(t.error_message) AS error FROM ${this.table('collection_runs')} r LEFT JOIN ${this.table('collection_tasks')} t ON t.tenant_id=r.tenant_id AND t.run_id=r.id WHERE r.tenant_id=$1 AND r.group_id=$2 GROUP BY r.id ORDER BY r.created_at DESC`,
      [this.tenantId, groupId],
    );
    return {
      items: r.rows.map((row) =>
        CollectionRunSchema.parse({
          id: row.id,
          groupId,
          status: row.failed
            ? 'failed'
            : row.completed === row.total
              ? 'completed'
              : row.running
                ? 'running'
                : 'queued',
          total: row.total,
          completed: row.completed,
          failed: row.failed,
          error: row.error,
          createdAt: new Date(row.created_at).toISOString(),
        }),
      ),
    };
  }
  /** 只重排失败任务，已成功任务保持原状态。 */
  async retryRun(groupId: string, runId: string) {
    const run = (await this.listRuns(groupId)).items.find((r) => r.id === runId);
    if (!run) throw new RagRepositoryError('NOT_FOUND', '补收任务不存在。');
    await this.pool.query(
      `UPDATE ${this.table('collection_tasks')} SET status='queued',error_message=NULL WHERE tenant_id=$1 AND run_id=$2 AND status='failed'`,
      [this.tenantId, runId],
    );
    return (await this.listRuns(groupId)).items.find((r) => r.id === runId)!;
  }
  /** 使用 SKIP LOCKED 和独立 token 接管过期任务。 */
  async claim(): Promise<CollectionTask | undefined> {
    const r = await this.pool.query(
      `WITH candidate AS(SELECT id FROM ${this.table('collection_tasks')} WHERE tenant_id=$1 AND (status='queued' OR (status='running' AND lease_until<now()) OR (kind='cleanup' AND status='failed' AND attempts<3 AND updated_at<now()-interval '1 minute')) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE ${this.table('collection_tasks')} t SET status='running',lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes',attempts=attempts+1,updated_at=now() FROM candidate WHERE t.id=candidate.id RETURNING t.*`,
      [this.tenantId],
    );
    const row = r.rows[0];
    return row
      ? { id: row.id, kind: row.kind, payload: row.payload, leaseToken: row.lease_token }
      : undefined;
  }
  /** 过期租约不能续租或写回任务终态。 */
  async taskState(
    task: CollectionTask,
    status: 'running' | 'completed' | 'failed',
    stage: string,
    message: string | null = null,
  ) {
    const r = await this.pool.query(
      `UPDATE ${this.table('collection_tasks')} SET status=$4,stage=$5,error_message=$6,lease_until=CASE WHEN $4='running' THEN now()+interval '2 minutes' ELSE NULL END,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND lease_token=$3 AND status='running' AND lease_until>now() RETURNING id`,
      [this.tenantId, task.id, task.leaseToken, status, stage, message],
    );
    if (!r.rowCount) this.conflict('收集任务租约已失效。');
  }
  /** 读取仍需发布的当前版本；旧版本任务只收敛，不反向覆盖。 */
  async projectionVersion(id: string, version: number) {
    const r = await this.pool.query(
      `SELECT v.id,v.document_revision_id FROM ${this.table('knowledge_case_versions')} v JOIN ${this.table('knowledge_cases')} c ON c.tenant_id=v.tenant_id AND c.id=v.case_id WHERE c.tenant_id=$1 AND c.id=$2 AND c.version=$3 AND v.version=$3 AND c.status='published'`,
      [this.tenantId, id, version],
    );
    return r.rows[0] as { id: string; document_revision_id: string | null } | undefined;
  }
  /** 媒体写回再次确认版本与状态，禁止删除后复活音频。 */
  async saveMedia(
    id: string,
    version: number,
    segmentId: string,
    status: 'ready' | 'missing' | 'failed',
    storageKey: string | null,
    message: string | null,
  ) {
    const r = await this.pool.query(
      `INSERT INTO ${this.table('knowledge_case_media')}(tenant_id,case_id,version,segment_id,status,storage_key,message) SELECT $1,$2,$3,$4,$5,$6,$7 FROM ${this.table('knowledge_cases')} WHERE tenant_id=$1 AND id=$2 AND version=$3 AND status='published' ON CONFLICT(tenant_id,case_id,version,segment_id) DO UPDATE SET status=EXCLUDED.status,storage_key=EXCLUDED.storage_key,message=EXCLUDED.message,updated_at=now() WHERE knowledge_case_media.status<>'ready' RETURNING segment_id`,
      [this.tenantId, id, version, segmentId, status, storageKey, message],
    );
    return !!r.rowCount;
  }
  /** 播放只允许正式案例的当前版本，客户端不能指定任意存储路径。 */
  async mediaKey(id: string, version: number, segmentId: string) {
    const current = await this.getCase(id);
    if (current.status !== 'published' || current.version !== version)
      throw new RagRepositoryError('NOT_FOUND', '案例音频不可用。');
    const r = await this.pool.query(
      `SELECT storage_key FROM ${this.table('knowledge_case_media')} WHERE tenant_id=$1 AND case_id=$2 AND version=$3 AND segment_id=$4 AND status='ready'`,
      [this.tenantId, id, version, segmentId],
    );
    if (!r.rows[0]?.storage_key) throw new RagRepositoryError('NOT_FOUND', '案例音频尚不可用。');
    return r.rows[0].storage_key as string;
  }
  /** 重试前使已丢失的独立片段失效，禁止继续返回播放地址。 */
  async invalidateMedia(id: string, version: number, segmentId: string) {
    await this.pool.query(
      `UPDATE ${this.table('knowledge_case_media')} m SET status='missing',storage_key=NULL,message='独立音频文件缺失，请恢复源文件后重试生成。' FROM ${this.table('knowledge_cases')} c WHERE m.tenant_id=$1 AND m.case_id=$2 AND m.version=$3 AND m.segment_id=$4 AND c.tenant_id=m.tenant_id AND c.id=m.case_id AND c.version=m.version AND c.status='published'`,
      [this.tenantId, id, version, segmentId],
    );
  }
  /** 删除媒体时仅返回当前租户已删除案例拥有的键。 */
  async cleanupKeys(id: string) {
    const r = await this.pool.query(
      `SELECT m.storage_key FROM ${this.table('knowledge_case_media')} m JOIN ${this.table('knowledge_cases')} c ON c.tenant_id=m.tenant_id AND c.id=m.case_id WHERE c.tenant_id=$1 AND c.id=$2 AND c.status='deleted' AND m.storage_key IS NOT NULL`,
      [this.tenantId, id],
    );
    const reservations = await this.pool.query(
      `SELECT t.id,turn->>'segmentId' AS segment_id FROM ${this.table('collection_tasks')} t JOIN ${this.table('knowledge_cases')} c ON c.tenant_id=t.tenant_id AND c.id=(t.payload->>'caseId')::uuid JOIN ${this.table('knowledge_case_versions')} v ON v.tenant_id=c.tenant_id AND v.case_id=c.id AND v.version=(t.payload->>'version')::int CROSS JOIN LATERAL jsonb_array_elements(v.content->'turns') turn WHERE t.tenant_id=$1 AND c.id=$2 AND c.status='deleted' AND t.kind='media'`,
      [this.tenantId, id],
    );
    return [
      ...new Set([
        ...r.rows.map((row) => row.storage_key as string),
        ...reservations.rows.map((row) => caseMediaKey(row.id, row.segment_id)),
      ]),
    ];
  }
  /** 清理成功后移除不可用媒体定位，保留案例审计。 */
  async mediaCleaned(id: string) {
    await this.pool.query(
      `UPDATE ${this.table('knowledge_case_media')} SET storage_key=NULL,status='missing',message='案例已删除。' WHERE tenant_id=$1 AND case_id=$2`,
      [this.tenantId, id],
    );
  }
  /** 手动重试只操作当前正式版本的任务，不改变审核状态。 */
  async retryCase(id: string, expectedVersion: number) {
    const current = await this.getCase(id);
    if (current.version !== expectedVersion || current.status !== 'published') this.conflict();
    await this.transaction(async (client) => {
      const locked = await client.query(
        `SELECT id FROM ${this.table('knowledge_cases')} WHERE tenant_id=$1 AND id=$2 AND version=$3 AND status='published' FOR UPDATE`,
        [this.tenantId, id, expectedVersion],
      );
      if (!locked.rowCount) this.conflict();
      await client.query(
        `UPDATE ${this.table('collection_tasks')} t SET status='queued',error_message=NULL
        WHERE t.tenant_id=$1 AND t.dedupe_key=$2 AND t.kind IN ('projection','media')
        AND (t.status='failed' OR (t.kind='media' AND t.status='completed' AND EXISTS(
          SELECT 1 FROM ${this.table('knowledge_case_media')} m WHERE m.tenant_id=t.tenant_id AND m.case_id=$3 AND m.version=$4 AND m.status<>'ready')))`,
        [this.tenantId, `${id}:${expectedVersion}`, id, expectedVersion],
      );
    });
    return current;
  }
}
