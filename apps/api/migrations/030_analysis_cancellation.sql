-- 为已取消的自动分析子任务提供可恢复、可诊断的取消标记。
ALTER TABLE audio_business_analysis_jobs
  ADD COLUMN cancel_requested boolean NOT NULL DEFAULT false;

CREATE INDEX audio_business_analysis_claim_not_canceled_idx
  ON audio_business_analysis_jobs (tenant_id, status, created_at)
  WHERE status = 'queued' AND cancel_requested = false;

ALTER TABLE audio_post_analysis_jobs
  ADD COLUMN cancel_requested boolean NOT NULL DEFAULT false;

CREATE INDEX audio_post_analysis_claim_not_canceled_idx
  ON audio_post_analysis_jobs (tenant_id, analysis_type, status, created_at)
  WHERE status = 'queued' AND cancel_requested = false;
