-- 为知识问答与业务分析增加租户级 Qwen 重排开关、能力绑定和可审计运行快照。
ALTER TABLE ai_capability_bindings
  DROP CONSTRAINT ai_capability_bindings_capability_check,
  ADD CONSTRAINT ai_capability_bindings_capability_check CHECK (capability IN (
    'knowledge_embedding', 'knowledge_rerank', 'knowledge_chat', 'audio_transcription',
    'audio_emotion', 'audio_role', 'audio_speaker_review', 'business_analysis',
    'audio_staging', 'audio_primary_storage'
  ));

CREATE TABLE tenant_knowledge_retrieval_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
  rerank_enabled boolean NOT NULL DEFAULT true,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO tenant_knowledge_retrieval_settings (tenant_id)
SELECT id FROM tenants
ON CONFLICT (tenant_id) DO NOTHING;

UPDATE knowledge_bases
SET reranker_model = 'qwen3.7-text-rerank'
WHERE reranker_model IS NULL OR btrim(reranker_model) = '';

ALTER TABLE knowledge_bases
  ALTER COLUMN reranker_model SET DEFAULT 'qwen3.7-text-rerank';

ALTER TABLE rag_runs
  ADD COLUMN rerank_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN reranker_model text,
  ADD COLUMN rerank_binding_revision_id uuid,
  ADD COLUMN rerank_tokens integer NOT NULL DEFAULT 0 CHECK (rerank_tokens >= 0),
  ADD COLUMN rerank_status text NOT NULL DEFAULT 'disabled'
    CHECK (rerank_status IN ('applied', 'disabled', 'fallback')),
  ADD CONSTRAINT rag_runs_rerank_binding_revision_fk
    FOREIGN KEY (tenant_id, rerank_binding_revision_id)
    REFERENCES ai_capability_binding_revisions(tenant_id, id);

-- 历史运行没有执行过重排，禁止用新默认值改写其语义。
UPDATE rag_runs SET rerank_enabled = false, rerank_status = 'disabled';

ALTER TABLE audio_business_analysis_jobs
  ADD COLUMN rerank_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN rerank_binding_revision_id uuid,
  ADD CONSTRAINT audio_business_analysis_rerank_binding_revision_fk
    FOREIGN KEY (tenant_id, rerank_binding_revision_id)
    REFERENCES ai_capability_binding_revisions(tenant_id, id);

-- 已存在或已排队任务继续使用创建时的旧检索行为。
UPDATE audio_business_analysis_jobs SET rerank_enabled = false;

COMMENT ON TABLE tenant_knowledge_retrieval_settings IS
  '租户级知识检索开关；客户端问答请求不得覆盖。';
COMMENT ON COLUMN audio_business_analysis_jobs.rerank_enabled IS
  '任务入队时冻结的重排开关，重试期间保持不变。';
