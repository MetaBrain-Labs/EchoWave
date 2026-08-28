-- 为分组级分析配置与版本化销售复盘结果建立独立、可审计的数据边界。
ALTER TABLE document_chunks
  ADD CONSTRAINT document_chunks_tenant_id_id_unique UNIQUE (tenant_id, id);

CREATE TABLE group_analysis_settings (
  tenant_id uuid NOT NULL,
  group_id uuid NOT NULL,
  analysis_timing text NOT NULL DEFAULT 'automatic'
    CHECK (analysis_timing IN ('automatic', 'manual')),
  content_focus text NOT NULL,
  tone text NOT NULL,
  custom_tags jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(custom_tags) = 'array'
    AND jsonb_array_length(custom_tags) <= 12
    AND NOT jsonb_path_exists(custom_tags, '$[*] ? (@.type() != "string")')
  ),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, group_id),
  FOREIGN KEY (tenant_id, group_id) REFERENCES groups(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE audio_business_analysis_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  group_id uuid NOT NULL,
  audio_file_id uuid NOT NULL,
  analysis_revision_id uuid NOT NULL,
  transcript_confirmation_id uuid NOT NULL,
  confirmation_version integer NOT NULL CHECK (confirmation_version > 0),
  model text NOT NULL,
  input_fingerprint text NOT NULL,
  settings_snapshot jsonb NOT NULL CHECK (jsonb_typeof(settings_snapshot) = 'object'),
  knowledge_base_ids uuid[] NOT NULL DEFAULT '{}',
  emotion_job_id uuid,
  role_job_id uuid,
  limitations jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(limitations) = 'array'
    AND NOT jsonb_path_exists(limitations, '$[*] ? (@.type() != "string")')
  ),
  status text NOT NULL CHECK (status IN ('queued', 'running', 'ready', 'failed')),
  progress smallint NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  error_code text,
  error_message text,
  error_retryable boolean,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  published_at timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, group_id, audio_file_id, id),
  FOREIGN KEY (tenant_id, group_id) REFERENCES groups(tenant_id, id),
  FOREIGN KEY (tenant_id, audio_file_id) REFERENCES audio_files(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, audio_file_id, analysis_revision_id)
    REFERENCES audio_analysis_revisions(tenant_id, audio_file_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, analysis_revision_id, transcript_confirmation_id)
    REFERENCES transcript_confirmations(tenant_id, analysis_revision_id, id),
  FOREIGN KEY (tenant_id, analysis_revision_id, emotion_job_id)
    REFERENCES audio_post_analysis_jobs(tenant_id, analysis_revision_id, id),
  FOREIGN KEY (tenant_id, analysis_revision_id, role_job_id)
    REFERENCES audio_post_analysis_jobs(tenant_id, analysis_revision_id, id)
);

CREATE UNIQUE INDEX uq_audio_business_analysis_running
  ON audio_business_analysis_jobs (tenant_id, group_id, audio_file_id)
  WHERE status IN ('queued', 'running');

CREATE INDEX audio_business_analysis_claim_idx
  ON audio_business_analysis_jobs (tenant_id, status, created_at);

CREATE INDEX audio_business_analysis_fingerprint_idx
  ON audio_business_analysis_jobs
    (tenant_id, group_id, audio_file_id, transcript_confirmation_id, input_fingerprint, created_at DESC);

CREATE TABLE audio_group_business_analysis_heads (
  tenant_id uuid NOT NULL,
  group_id uuid NOT NULL,
  audio_file_id uuid NOT NULL,
  active_job_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, group_id, audio_file_id),
  FOREIGN KEY (tenant_id, group_id, audio_file_id, active_job_id)
    REFERENCES audio_business_analysis_jobs(tenant_id, group_id, audio_file_id, id)
);

CREATE TABLE business_analysis_summary_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  job_id uuid NOT NULL,
  section_index integer NOT NULL CHECK (section_index > 0),
  title text NOT NULL,
  body text NOT NULL,
  UNIQUE (tenant_id, job_id, section_index),
  FOREIGN KEY (tenant_id, job_id)
    REFERENCES audio_business_analysis_jobs(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE business_analysis_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  job_id uuid NOT NULL,
  tag_index integer NOT NULL CHECK (tag_index > 0),
  category text NOT NULL CHECK (
    category IN ('strength', 'improvement', 'risk', 'suggestion', 'custom')
  ),
  custom_label text,
  title text NOT NULL,
  summary text NOT NULL,
  details jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(details) = 'array'
    AND NOT jsonb_path_exists(details, '$[*] ? (@.type() != "string")')
  ),
  confidence smallint NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  CHECK (
    (category = 'custom' AND custom_label IS NOT NULL AND char_length(custom_label) <= 24)
    OR (category <> 'custom' AND custom_label IS NULL)
  ),
  UNIQUE (tenant_id, job_id, tag_index),
  UNIQUE (tenant_id, job_id, id),
  FOREIGN KEY (tenant_id, job_id)
    REFERENCES audio_business_analysis_jobs(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE business_analysis_tag_segments (
  tenant_id uuid NOT NULL,
  job_id uuid NOT NULL,
  tag_id uuid NOT NULL,
  analysis_revision_id uuid NOT NULL,
  transcript_segment_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, job_id, tag_id, transcript_segment_id),
  FOREIGN KEY (tenant_id, job_id, tag_id)
    REFERENCES business_analysis_tags(tenant_id, job_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, analysis_revision_id, transcript_segment_id)
    REFERENCES transcript_segments(tenant_id, analysis_revision_id, id) ON DELETE CASCADE
);

CREATE TABLE business_analysis_citations (
  tenant_id uuid NOT NULL,
  job_id uuid NOT NULL,
  tag_id uuid NOT NULL,
  chunk_id uuid NOT NULL,
  knowledge_base_id uuid NOT NULL,
  document_id uuid NOT NULL,
  document_title text NOT NULL,
  locator jsonb NOT NULL CHECK (jsonb_typeof(locator) = 'object'),
  PRIMARY KEY (tenant_id, job_id, tag_id, chunk_id),
  FOREIGN KEY (tenant_id, job_id, tag_id)
    REFERENCES business_analysis_tags(tenant_id, job_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, chunk_id)
    REFERENCES document_chunks(tenant_id, id)
);
