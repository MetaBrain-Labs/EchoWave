-- 建立上传后自动执行、一次性调度、批量恢复和阶段编排的 PostgreSQL 权威任务模型。
CREATE TABLE audio_analysis_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  data_source_id uuid NOT NULL,
  group_id uuid NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN ('uploads', 'existing_audio')),
  scheduled_for timestamptz,
  pipeline_snapshot jsonb NOT NULL CHECK (jsonb_typeof(pipeline_snapshot) = 'object'),
  configuration_snapshot jsonb NOT NULL CHECK (jsonb_typeof(configuration_snapshot) = 'object'),
  canceled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, data_source_id) REFERENCES data_sources(tenant_id, id),
  FOREIGN KEY (tenant_id, group_id) REFERENCES groups(tenant_id, id)
);

CREATE TABLE audio_analysis_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  batch_id uuid NOT NULL,
  audio_file_id uuid,
  client_item_id varchar(80),
  title varchar(255) NOT NULL,
  runtime_mode text CHECK (runtime_mode IN ('hybrid', 'object_storage', 'lightweight_local')),
  status text NOT NULL CHECK (status IN (
    'awaiting_upload', 'scheduled', 'queued', 'running', 'hard_blocked',
    'completed', 'completed_with_warnings', 'failed', 'canceled'
  )),
  phase text NOT NULL CHECK (phase IN (
    'upload', 'transcription', 'post_analysis', 'business_analysis', 'done'
  )),
  progress smallint NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  run_after timestamptz,
  analysis_revision_id uuid,
  emotion_job_id uuid,
  role_job_id uuid,
  business_job_id uuid,
  warning_codes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(warning_codes) = 'array'
    AND NOT jsonb_path_exists(warning_codes, '$[*] ? (@.type() != "string")')
  ),
  blocker_reason text CHECK (blocker_reason IN (
    'API_QUOTA_EXCEEDED', 'INVALID_CREDENTIALS', 'CONFIGURATION_REQUIRED',
    'SOURCE_REMOUNT_REQUIRED'
  )),
  blocker_capability text,
  blocker_message varchar(500),
  source_expires_at timestamptz,
  error_code text,
  error_message varchar(500),
  error_retryable boolean,
  cancel_requested boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, batch_id, audio_file_id),
  UNIQUE (tenant_id, batch_id, client_item_id),
  FOREIGN KEY (tenant_id, batch_id)
    REFERENCES audio_analysis_batches(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, audio_file_id)
    REFERENCES audio_files(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, audio_file_id, analysis_revision_id)
    REFERENCES audio_analysis_revisions(tenant_id, audio_file_id, id),
  FOREIGN KEY (tenant_id, analysis_revision_id, emotion_job_id)
    REFERENCES audio_post_analysis_jobs(tenant_id, analysis_revision_id, id),
  FOREIGN KEY (tenant_id, analysis_revision_id, role_job_id)
    REFERENCES audio_post_analysis_jobs(tenant_id, analysis_revision_id, id),
  FOREIGN KEY (tenant_id, business_job_id)
    REFERENCES audio_business_analysis_jobs(tenant_id, id),
  CHECK ((blocker_reason IS NULL) = (blocker_capability IS NULL)),
  CHECK (audio_file_id IS NOT NULL OR status = 'awaiting_upload')
);

CREATE TABLE audio_analysis_batch_blockers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  capability text NOT NULL,
  binding_revision_id uuid,
  reason text NOT NULL CHECK (reason IN (
    'API_QUOTA_EXCEEDED', 'INVALID_CREDENTIALS', 'CONFIGURATION_REQUIRED'
  )),
  message varchar(500) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  FOREIGN KEY (tenant_id, batch_id)
    REFERENCES audio_analysis_batches(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, binding_revision_id)
    REFERENCES ai_capability_binding_revisions(tenant_id, id)
);

CREATE UNIQUE INDEX audio_analysis_batch_blockers_active_idx
  ON audio_analysis_batch_blockers (tenant_id, batch_id, capability, reason)
  WHERE active = true;

ALTER TABLE audio_upload_sessions
  ADD COLUMN analysis_task_id uuid,
  ADD CONSTRAINT audio_upload_sessions_analysis_task_fk
    FOREIGN KEY (tenant_id, analysis_task_id)
    REFERENCES audio_analysis_tasks(tenant_id, id);

CREATE INDEX audio_analysis_tasks_due_idx
  ON audio_analysis_tasks (tenant_id, run_after, created_at)
  WHERE status IN ('scheduled', 'queued', 'running');

CREATE INDEX audio_analysis_tasks_batch_idx
  ON audio_analysis_tasks (tenant_id, batch_id, created_at);

CREATE INDEX audio_analysis_tasks_stage_idx
  ON audio_analysis_tasks
    (tenant_id, analysis_revision_id, emotion_job_id, role_job_id, business_job_id)
  WHERE status = 'running';

CREATE OR REPLACE FUNCTION notify_audio_analysis_automation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT'
     OR OLD.status IS DISTINCT FROM NEW.status
     OR OLD.phase IS DISTINCT FROM NEW.phase THEN
    PERFORM pg_notify(
      'echowave_worker_jobs',
      json_build_object(
        'schema', TG_TABLE_SCHEMA,
        'tenantId', NEW.tenant_id,
        'queue', 'audio-analysis-automation'
      )::text
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER audio_analysis_tasks_automation_notify
AFTER INSERT OR UPDATE ON audio_analysis_tasks
FOR EACH ROW EXECUTE FUNCTION notify_audio_analysis_automation();

CREATE TRIGGER audio_transcriptions_automation_notify
AFTER UPDATE ON audio_analysis_revisions
FOR EACH ROW EXECUTE FUNCTION notify_audio_analysis_automation();

CREATE TRIGGER audio_post_analysis_automation_notify
AFTER UPDATE ON audio_post_analysis_jobs
FOR EACH ROW EXECUTE FUNCTION notify_audio_analysis_automation();

CREATE TRIGGER audio_business_analysis_automation_notify
AFTER UPDATE ON audio_business_analysis_jobs
FOR EACH ROW EXECUTE FUNCTION notify_audio_analysis_automation();
