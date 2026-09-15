-- 录音暂存意图与请求身份在 PostgreSQL 固化，重试不能隐式改变操作。
ALTER TABLE audio_upload_sessions
 ADD COLUMN post_upload_action text NOT NULL DEFAULT 'transcribe'
 CHECK (post_upload_action IN ('transcribe', 'store_only')),
 ADD COLUMN idempotency_key text,
 ADD COLUMN request_snapshot jsonb;
CREATE UNIQUE INDEX audio_upload_session_request_identity
 ON audio_upload_sessions (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
ALTER TABLE audio_analysis_batches ADD COLUMN idempotency_key text, ADD COLUMN request_snapshot jsonb;
CREATE UNIQUE INDEX audio_analysis_batch_request_identity
 ON audio_analysis_batches (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
