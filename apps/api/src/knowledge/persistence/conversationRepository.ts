/**
 * 问答会话与审计持久层。
 *
 * 管理租户范围内的 RAG 会话、运行审计和过期记录，不参与向量检索或模型调用。
 *
 * Responsibilities:
 * - 创建或续期同知识库问答会话。
 * - 记录运行开始、完成与失败状态。
 * - 列出并条件删除过期会话。
 *
 * Notes:
 * - checkpoint 必须由可信回答模块先删除。
 */
import { quoteIdentifier, type DatabasePool } from '../../infrastructure/postgres.ts';

import { RagRepositoryError } from './errors.ts';

/** 隐藏问答会话和运行审计 SQL 的 PostgreSQL 仓储。 */
export class ConversationRepository {
  private readonly schema: string;

  constructor(
    private readonly pool: DatabasePool,
    schema: string,
    private readonly tenantId: string,
  ) {
    this.schema = quoteIdentifier(schema);
  }

  private table(name: string): string {
    return `${this.schema}.${quoteIdentifier(name)}`;
  }

  /** 复用同租户、同知识库且未过期的会话并续期；否则为有效知识库创建新会话。 */
  async getOrCreateConversation(knowledgeBaseId: string, conversationId?: string) {
    if (conversationId) {
      const existing = await this.pool.query(
        `UPDATE ${this.table('rag_conversations')}
         SET expires_at = now() + interval '30 days', updated_at = now()
         WHERE tenant_id = $1 AND knowledge_base_id = $2 AND id = $3 AND expires_at > now()
         RETURNING id, thread_id`,
        [this.tenantId, knowledgeBaseId, conversationId],
      );
      if (!existing.rowCount) throw new RagRepositoryError('NOT_FOUND', '会话不存在或已过期。');
      return { id: existing.rows[0].id as string, threadId: existing.rows[0].thread_id as string };
    }
    const created = await this.pool.query(
      `INSERT INTO ${this.table('rag_conversations')}
         (tenant_id, knowledge_base_id, thread_id, expires_at)
       SELECT $1, kb.id, gen_random_uuid(), now() + interval '30 days'
       FROM ${this.table('knowledge_bases')} kb
       WHERE kb.tenant_id = $1 AND kb.id = $2 AND kb.deleted_at IS NULL
       RETURNING id, thread_id`,
      [this.tenantId, knowledgeBaseId],
    );
    if (!created.rowCount) throw new RagRepositoryError('NOT_FOUND', '知识库不存在。');
    return { id: created.rows[0].id as string, threadId: created.rows[0].thread_id as string };
  }

  /** 在调用模型前创建 running 审计记录，使失败请求也拥有可追踪的运行标识。 */
  async beginRun(input: {
    knowledgeBaseId: string; conversationId: string; question: string;
    embeddingModel: string; chatModel: string; chatProvider: string;
  }): Promise<string> {
    const result = await this.pool.query(
      `INSERT INTO ${this.table('rag_runs')}
         (tenant_id, knowledge_base_id, conversation_id, question, embedding_model, chat_model, chat_provider, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'running') RETURNING id`,
      [this.tenantId, input.knowledgeBaseId, input.conversationId, input.question,
        input.embeddingModel, input.chatModel, input.chatProvider],
    );
    return result.rows[0].id as string;
  }

  /** 在可信性校验完成后一次性写入答案、引用、用量与耗时，并标记运行成功。 */
  async completeRun(runId: string, input: {
    answer: string; grounded: boolean; citedChunkIds: string[]; embeddingTokens: number;
    inputTokens: number; outputTokens: number; durationMs: number;
  }): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.table('rag_runs')}
       SET answer=$3, grounded=$4, cited_chunk_ids=$5::jsonb, embedding_tokens=$6,
           input_tokens=$7, output_tokens=$8, duration_ms=$9, status='completed', completed_at=now()
       WHERE tenant_id=$1 AND id=$2`,
      [this.tenantId, runId, input.answer, input.grounded, JSON.stringify(input.citedChunkIds),
        input.embeddingTokens, input.inputTokens, input.outputTokens, input.durationMs],
    );
  }

  /** 将已开始但未生成可信响应的运行标记为失败，同时保留原始问题与模型元数据。 */
  async failRun(runId: string, durationMs: number): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.table('rag_runs')}
       SET duration_ms=$3, status='failed', completed_at=now() WHERE tenant_id=$1 AND id=$2`,
      [this.tenantId, runId, durationMs],
    );
  }

  /** 分批列出过期会话，供可信回答模块先清理 checkpoint 再删除会话记录。 */
  async listExpiredConversations(): Promise<{ id: string; threadId: string }[]> {
    const result = await this.pool.query(
      `SELECT id, thread_id FROM ${this.table('rag_conversations')}
       WHERE tenant_id = $1 AND expires_at <= now() LIMIT 500`,
      [this.tenantId],
    );
    return result.rows.map((row) => ({ id: row.id, threadId: row.thread_id }));
  }

  /** 仅删除在执行时仍然过期的会话，避免与并发续期竞争时误删活跃会话。 */
  async deleteExpiredConversation(id: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM ${this.table('rag_conversations')}
       WHERE tenant_id = $1 AND id = $2 AND expires_at <= now()`,
      [this.tenantId, id],
    );
  }
}

