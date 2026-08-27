-- 将 ASR 后置情绪分析与角色识别建模为独立、可重跑且非破坏发布的任务。
ALTER TABLE data_sources
  ADD COLUMN custom_business_roles jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(custom_business_roles) = 'array'
    AND jsonb_array_length(custom_business_roles) <= 16
    AND NOT jsonb_path_exists(custom_business_roles, '$[*] ? (@.type() != "string")')
  );

CREATE TABLE audio_post_analysis_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  audio_file_id uuid NOT NULL,
  analysis_revision_id uuid NOT NULL,
  analysis_type text NOT NULL CHECK (analysis_type IN ('emotion', 'role')),
  model text NOT NULL,
  input_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(input_snapshot) = 'object'),
  status text NOT NULL CHECK (status IN ('queued', 'running', 'ready', 'failed')),
  progress smallint NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  error_code text,
  error_message text,
  error_retryable boolean,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  published_at timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, analysis_revision_id, id),
  FOREIGN KEY (tenant_id, audio_file_id)
    REFERENCES audio_files(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, audio_file_id, analysis_revision_id)
    REFERENCES audio_analysis_revisions(tenant_id, audio_file_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX audio_post_analysis_single_running_idx
  ON audio_post_analysis_jobs (tenant_id, analysis_revision_id, analysis_type)
  WHERE status IN ('queued', 'running');

CREATE INDEX audio_post_analysis_claim_idx
  ON audio_post_analysis_jobs (tenant_id, analysis_type, status, created_at);

CREATE TABLE segment_emotion_results (
  tenant_id uuid NOT NULL,
  job_id uuid NOT NULL,
  analysis_revision_id uuid NOT NULL,
  transcript_segment_id uuid NOT NULL,
  emotion_label text NOT NULL CHECK (emotion_label IN (
    'neutral', 'happy', 'sad', 'angry', 'anxious', 'excited', 'impatient',
    'frustrated', 'sarcastic', 'other', 'unknown'
  )),
  confidence double precision NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  attitude text NOT NULL,
  arousal text NOT NULL,
  pace text NOT NULL,
  volume_trend text NOT NULL,
  pitch_variation text NOT NULL,
  pause_pattern text NOT NULL,
  vocal_cues jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(vocal_cues) = 'array'
    AND jsonb_array_length(vocal_cues) <= 5
    AND NOT jsonb_path_exists(vocal_cues, '$[*] ? (@.type() != "string")')
  ),
  PRIMARY KEY (tenant_id, job_id, transcript_segment_id),
  FOREIGN KEY (tenant_id, analysis_revision_id, job_id)
    REFERENCES audio_post_analysis_jobs(tenant_id, analysis_revision_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, analysis_revision_id, transcript_segment_id)
    REFERENCES transcript_segments(tenant_id, analysis_revision_id, id) ON DELETE CASCADE
);

CREATE TABLE speaker_role_results (
  tenant_id uuid NOT NULL,
  job_id uuid NOT NULL,
  analysis_revision_id uuid NOT NULL,
  speaker_key text NOT NULL,
  role_kind text NOT NULL CHECK (role_kind IN ('sales', 'customer', 'other', 'unknown', 'custom')),
  role_label text NOT NULL,
  confidence double precision NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  evidence_segment_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(evidence_segment_ids) = 'array'
    AND jsonb_array_length(evidence_segment_ids) <= 3
    AND NOT jsonb_path_exists(evidence_segment_ids, '$[*] ? (@.type() != "string")')
  ),
  PRIMARY KEY (tenant_id, job_id, speaker_key),
  FOREIGN KEY (tenant_id, analysis_revision_id, job_id)
    REFERENCES audio_post_analysis_jobs(tenant_id, analysis_revision_id, id) ON DELETE CASCADE
);

ALTER TABLE audio_analysis_revisions
  ADD COLUMN active_emotion_job_id uuid,
  ADD COLUMN active_role_job_id uuid,
  ADD CONSTRAINT audio_analysis_revisions_active_emotion_fk
    FOREIGN KEY (tenant_id, id, active_emotion_job_id)
    REFERENCES audio_post_analysis_jobs(tenant_id, analysis_revision_id, id),
  ADD CONSTRAINT audio_analysis_revisions_active_role_fk
    FOREIGN KEY (tenant_id, id, active_role_job_id)
    REFERENCES audio_post_analysis_jobs(tenant_id, analysis_revision_id, id);
