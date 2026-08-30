ALTER TABLE audio_business_analysis_jobs
  ADD COLUMN workflow_version text NOT NULL DEFAULT 'langgraph-v1',
  ADD COLUMN recovery_attempts smallint NOT NULL DEFAULT 0
    CHECK (recovery_attempts BETWEEN 0 AND 2),
  ADD COLUMN next_attempt_at timestamptz,
  ADD COLUMN checkpoint_cleanup_pending boolean NOT NULL DEFAULT false;

CREATE INDEX audio_business_analysis_due_idx
  ON audio_business_analysis_jobs (tenant_id, next_attempt_at, created_at)
  WHERE status = 'queued';
