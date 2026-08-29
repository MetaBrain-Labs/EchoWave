-- 为音频分析详情持久化安全、可查询的 AI 执行轨迹，不保存提示词、模型原文或隐藏推理。
CREATE TABLE ai_execution_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  audio_file_id uuid NOT NULL,
  analysis_revision_id uuid NOT NULL,
  group_id uuid,
  source_job_id uuid,
  kind text NOT NULL CHECK (
    kind IN (
      'audio-transcription',
      'audio-emotion-analysis',
      'audio-role-recognition',
      'audio-business-analysis'
    )
  ),
  name text NOT NULL,
  phase text,
  status text NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'interrupted')),
  error_code text,
  error_message text,
  error_retryable boolean,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  duration_ms bigint CHECK (duration_ms IS NULL OR duration_ms >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, audio_file_id)
    REFERENCES audio_files(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, audio_file_id, analysis_revision_id)
    REFERENCES audio_analysis_revisions(tenant_id, audio_file_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, group_id)
    REFERENCES groups(tenant_id, id) ON DELETE CASCADE,
  CHECK (
    (status = 'running' AND completed_at IS NULL)
    OR (status <> 'running' AND completed_at IS NOT NULL)
  )
);

CREATE INDEX ai_execution_runs_revision_timeline_idx
  ON ai_execution_runs (tenant_id, analysis_revision_id, started_at DESC);

CREATE INDEX ai_execution_runs_group_timeline_idx
  ON ai_execution_runs (tenant_id, group_id, analysis_revision_id, started_at DESC)
  WHERE group_id IS NOT NULL;

CREATE TABLE ai_execution_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  execution_run_id uuid NOT NULL,
  sequence_no integer NOT NULL CHECK (sequence_no > 0),
  event_type text NOT NULL CHECK (event_type IN ('step', 'model_call', 'tool_call')),
  name text NOT NULL,
  status text NOT NULL CHECK (status IN ('started', 'completed', 'failed')),
  occurred_at timestamptz NOT NULL,
  duration_ms bigint CHECK (duration_ms IS NULL OR duration_ms >= 0),
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  UNIQUE (tenant_id, execution_run_id, sequence_no),
  FOREIGN KEY (tenant_id, execution_run_id)
    REFERENCES ai_execution_runs(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX ai_execution_events_run_sequence_idx
  ON ai_execution_events (tenant_id, execution_run_id, sequence_no);
