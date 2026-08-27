-- 统一后续知识嵌入和音频转写到 DashScope 官方接口；历史来源记录保持不变。
ALTER TABLE knowledge_bases
  ALTER COLUMN embedding_model SET DEFAULT 'qwen3.7-text-embedding';

UPDATE knowledge_bases
SET embedding_model = 'qwen3.7-text-embedding', updated_at = now()
WHERE embedding_model <> 'qwen3.7-text-embedding';

-- 不允许新查询向量与旧模型向量混用；保留旧 revision 和 chunk 供审计与手动重传。
UPDATE documents d
SET active_revision_id = NULL,
    status = 'failed',
    progress = 0,
    error_code = 'EMBEDDING_MODEL_MIGRATION_REQUIRED',
    error_message = '嵌入模型已更新，请重新上传原文件以恢复检索。',
    error_retryable = false,
    updated_at = now()
FROM document_revisions r
WHERE d.active_revision_id = r.id
  AND r.embedding_model <> 'qwen3.7-text-embedding'
  AND d.deleted_at IS NULL;

DROP INDEX document_revision_hash_idx;
CREATE UNIQUE INDEX document_revision_hash_idx
  ON document_revisions (tenant_id, document_id, source_sha256, embedding_model);

ALTER TABLE document_revisions
  RENAME COLUMN embedding_cost_usd TO embedding_cost_amount;

ALTER TABLE document_revisions
  ADD COLUMN embedding_cost_currency text NOT NULL DEFAULT 'USD'
    CHECK (embedding_cost_currency IN ('USD', 'CNY'));

-- 未完成的旧供应商任务不能由只支持 DashScope 的 worker 继续领取。
UPDATE audio_analysis_revisions
SET status = 'failed',
    progress = 0,
    processing_stage = NULL,
    current_chunk = NULL,
    chunk_count = NULL,
    current_chunk_start_ms = NULL,
    current_chunk_end_ms = NULL,
    network_attempt = NULL,
    structure_attempt = NULL,
    processing_updated_at = now(),
    error_stage = 'transcription',
    error_code = 'PROVIDER_REMOVED',
    error_message = '原转写供应商已停用，请使用 DashScope 官方模型重新转写。',
    error_retryable = false,
    completed_at = now()
WHERE transcription_provider = 'openrouter'
  AND status IN ('queued', 'transcribing', 'analyzing');

UPDATE data_sources
SET transcription_model = 'qwen-audio-3.0-asr-flash-filetrans', updated_at = now()
WHERE transcription_model <> 'qwen-audio-3.0-asr-flash-filetrans';

ALTER TABLE audio_analysis_revisions
  ALTER COLUMN transcription_provider SET DEFAULT 'dashscope';
