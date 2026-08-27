-- 保存异步语音供应商任务状态，支持进程重启后继续轮询且不重复提交。
ALTER TABLE audio_analysis_revisions
  ADD COLUMN transcription_provider text NOT NULL DEFAULT 'openrouter'
    CHECK (transcription_provider IN ('openrouter', 'dashscope')),
  ADD COLUMN provider_task_id text,
  ADD COLUMN provider_artifact_key text,
  ADD COLUMN provider_submitted_at timestamptz;

CREATE INDEX audio_analysis_revisions_provider_task_idx
  ON audio_analysis_revisions (tenant_id, transcription_provider, provider_task_id)
  WHERE provider_task_id IS NOT NULL;
