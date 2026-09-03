-- 为音频资产固化运行模式、源文件生命周期、ASR 选择策略和可恢复上传状态。
CREATE TABLE tenant_audio_runtime_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
  mode text NOT NULL DEFAULT 'hybrid' CHECK (
    mode IN ('hybrid', 'object_storage', 'lightweight_local')
  ),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  original_retention_days integer CHECK (
    original_retention_days IS NULL OR original_retention_days BETWEEN 1 AND 3650
  ),
  intermediate_retention_hours integer NOT NULL DEFAULT 24 CHECK (
    intermediate_retention_hours BETWEEN 1 AND 168
  ),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO tenant_audio_runtime_settings (tenant_id)
SELECT id FROM tenants
ON CONFLICT (tenant_id) DO NOTHING;

ALTER TABLE ai_capability_bindings
  DROP CONSTRAINT ai_capability_bindings_capability_check,
  ADD CONSTRAINT ai_capability_bindings_capability_check CHECK (capability IN (
    'knowledge_embedding', 'knowledge_chat', 'audio_transcription', 'audio_emotion',
    'audio_role', 'audio_speaker_review', 'business_analysis', 'audio_staging',
    'audio_primary_storage'
  ));

ALTER TABLE audio_files
  ADD COLUMN runtime_mode text NOT NULL DEFAULT 'hybrid' CHECK (
    runtime_mode IN ('hybrid', 'object_storage', 'lightweight_local')
  ),
  ADD COLUMN storage_backend text NOT NULL DEFAULT 'local_persistent' CHECK (
    storage_backend IN ('local_persistent', 'local_ephemeral', 'aliyun_oss')
  ),
  ADD COLUMN storage_binding_revision_id uuid,
  ADD COLUMN source_sha256 varchar(64) CHECK (
    source_sha256 IS NULL OR source_sha256 ~ '^[0-9a-f]{64}$'
  ),
  ADD COLUMN source_state text NOT NULL DEFAULT 'available' CHECK (
    source_state IN ('available', 'cleaned', 'missing')
  ),
  ADD COLUMN source_delete_after timestamptz,
  ADD COLUMN source_recovery_state text NOT NULL DEFAULT 'not_required' CHECK (
    source_recovery_state IN ('not_required', 'required', 'verifying')
  ),
  ADD COLUMN cleanup_status text NOT NULL DEFAULT 'not_due' CHECK (
    cleanup_status IN ('not_due', 'pending', 'completed', 'failed')
  ),
  ADD COLUMN transcript_selection_mode text NOT NULL DEFAULT 'auto' CHECK (
    transcript_selection_mode IN ('auto', 'manual')
  ),
  ADD CONSTRAINT audio_files_storage_binding_revision_fk
    FOREIGN KEY (tenant_id, storage_binding_revision_id)
    REFERENCES ai_capability_binding_revisions(tenant_id, id);

ALTER TABLE audio_analysis_revisions
  ADD COLUMN include_acoustic_emotion boolean NOT NULL DEFAULT true,
  ADD COLUMN retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count BETWEEN 0 AND 3),
  ADD COLUMN processing_checkpoint text NOT NULL DEFAULT 'source_validated' CHECK (
    processing_checkpoint IN (
      'source_validated', 'preprocessing_ready', 'provider_staged', 'provider_submitted',
      'provider_terminal', 'transcript_published', 'acoustic_emotion_completed',
      'cleanup_completed'
    )
  ),
  ADD COLUMN bundled_emotion_job_id uuid,
  ADD COLUMN bundled_emotion_binding_revision_id uuid,
  ADD COLUMN bundled_emotion_model varchar(160),
  ADD CONSTRAINT audio_analysis_revisions_bundled_emotion_binding_fk
    FOREIGN KEY (tenant_id, bundled_emotion_binding_revision_id)
    REFERENCES ai_capability_binding_revisions(tenant_id, id),
  ADD CONSTRAINT audio_analysis_revisions_bundled_emotion_fk
    FOREIGN KEY (tenant_id, id, bundled_emotion_job_id)
    REFERENCES audio_post_analysis_jobs(tenant_id, analysis_revision_id, id);

ALTER TABLE audio_post_analysis_jobs
  ADD COLUMN retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count BETWEEN 0 AND 3);

CREATE TABLE audio_upload_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  data_source_id uuid NOT NULL,
  audio_file_id uuid NOT NULL,
  runtime_mode text NOT NULL CHECK (
    runtime_mode IN ('hybrid', 'object_storage', 'lightweight_local')
  ),
  upload_strategy text NOT NULL CHECK (upload_strategy IN ('api_binary', 'presigned_put')),
  original_filename varchar(255) NOT NULL,
  mime_type varchar(160) NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 209715200),
  storage_key text NOT NULL,
  include_acoustic_emotion boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'created' CHECK (
    status IN ('created', 'uploaded', 'validating', 'ready', 'failed', 'expired')
  ),
  expires_at timestamptz NOT NULL,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, data_source_id)
    REFERENCES data_sources(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, audio_file_id)
    REFERENCES audio_files(tenant_id, id) ON DELETE CASCADE
);

ALTER TABLE transcript_confirmations
  ADD COLUMN origin text NOT NULL DEFAULT 'user_confirmed' CHECK (
    origin IN ('user_confirmed', 'system_raw_snapshot')
  );

CREATE INDEX audio_upload_sessions_expiry_idx
  ON audio_upload_sessions (tenant_id, status, expires_at);

CREATE INDEX audio_files_source_cleanup_idx
  ON audio_files (tenant_id, source_state, source_delete_after)
  WHERE source_delete_after IS NOT NULL;
