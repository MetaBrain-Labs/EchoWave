ALTER TABLE knowledge_bases
  ADD CONSTRAINT knowledge_bases_tenant_id_id_unique UNIQUE (tenant_id, id);

CREATE TABLE groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name varchar(120) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (tenant_id, id)
);

CREATE INDEX groups_tenant_updated_idx
  ON groups (tenant_id, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE group_knowledge_bases (
  tenant_id uuid NOT NULL,
  group_id uuid NOT NULL,
  knowledge_base_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, group_id, knowledge_base_id),
  FOREIGN KEY (tenant_id, group_id) REFERENCES groups(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, knowledge_base_id)
    REFERENCES knowledge_bases(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX group_knowledge_bases_knowledge_idx
  ON group_knowledge_bases (tenant_id, knowledge_base_id, group_id);

CREATE TABLE data_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name varchar(120) NOT NULL,
  description varchar(1000) NOT NULL DEFAULT '',
  source_type text NOT NULL CHECK (
    source_type IN ('manual_upload', 'http_api', 'cloud_drive', 's3', 'local_folder')
  ),
  location text NOT NULL CHECK (location IN ('local', 'cloud')),
  connection_label varchar(255) NOT NULL,
  connection_status text NOT NULL DEFAULT 'connected' CHECK (
    connection_status IN ('connected', 'disconnected', 'error', 'disabled')
  ),
  transcription_model text NOT NULL,
  auto_transcribe boolean NOT NULL DEFAULT true,
  emotion_analysis_enabled boolean NOT NULL DEFAULT true,
  speaker_diarization_enabled boolean NOT NULL DEFAULT true,
  scene_segmentation_enabled boolean NOT NULL DEFAULT true,
  skip_invalid_audio boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (tenant_id, id)
);

CREATE INDEX data_sources_tenant_updated_idx
  ON data_sources (tenant_id, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE group_data_sources (
  tenant_id uuid NOT NULL,
  group_id uuid NOT NULL,
  data_source_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, group_id, data_source_id),
  FOREIGN KEY (tenant_id, group_id) REFERENCES groups(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, data_source_id)
    REFERENCES data_sources(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX group_data_sources_source_idx
  ON group_data_sources (tenant_id, data_source_id, group_id);

CREATE TABLE data_source_ingestion_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  data_source_id uuid NOT NULL,
  trigger_kind text NOT NULL CHECK (trigger_kind IN ('manual', 'sync')),
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'partial', 'failed')),
  error_code text,
  error_message text,
  error_retryable boolean,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, data_source_id, id),
  FOREIGN KEY (tenant_id, data_source_id)
    REFERENCES data_sources(tenant_id, id)
);

CREATE INDEX data_source_ingestion_runs_timeline_idx
  ON data_source_ingestion_runs (tenant_id, data_source_id, started_at DESC);

CREATE TABLE audio_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  data_source_id uuid,
  ingestion_run_id uuid,
  origin_group_id uuid,
  title text NOT NULL,
  original_filename text,
  mime_type text,
  size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  duration_ms bigint CHECK (duration_ms IS NULL OR duration_ms >= 0),
  storage_key text,
  source_external_id text,
  upload_status text NOT NULL CHECK (upload_status IN ('uploading', 'ready', 'failed', 'deleting')),
  upload_progress smallint NOT NULL DEFAULT 0 CHECK (upload_progress BETWEEN 0 AND 100),
  error_code text,
  error_message text,
  error_retryable boolean,
  active_analysis_revision_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, data_source_id)
    REFERENCES data_sources(tenant_id, id),
  FOREIGN KEY (tenant_id, data_source_id, ingestion_run_id)
    REFERENCES data_source_ingestion_runs(tenant_id, data_source_id, id),
  FOREIGN KEY (tenant_id, origin_group_id)
    REFERENCES groups(tenant_id, id)
);

CREATE UNIQUE INDEX audio_files_source_external_idx
  ON audio_files (tenant_id, data_source_id, source_external_id)
  WHERE data_source_id IS NOT NULL AND source_external_id IS NOT NULL;

CREATE INDEX audio_files_source_timeline_idx
  ON audio_files (tenant_id, data_source_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE group_audio_links (
  tenant_id uuid NOT NULL,
  group_id uuid NOT NULL,
  audio_file_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, group_id, audio_file_id),
  FOREIGN KEY (tenant_id, group_id) REFERENCES groups(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, audio_file_id)
    REFERENCES audio_files(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX group_audio_links_audio_idx
  ON group_audio_links (tenant_id, audio_file_id, group_id);

CREATE TABLE audio_analysis_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  audio_file_id uuid NOT NULL,
  revision_no integer NOT NULL CHECK (revision_no > 0),
  transcription_model text NOT NULL,
  analysis_model text NOT NULL,
  settings_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(settings_snapshot) = 'object'
  ),
  status text NOT NULL CHECK (status IN ('queued', 'transcribing', 'analyzing', 'ready', 'failed')),
  progress smallint NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  error_stage text CHECK (error_stage IS NULL OR error_stage IN ('transcription', 'analysis', 'publish')),
  error_code text,
  error_message text,
  error_retryable boolean,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  published_at timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, audio_file_id, revision_no),
  UNIQUE (tenant_id, audio_file_id, id),
  FOREIGN KEY (tenant_id, audio_file_id)
    REFERENCES audio_files(tenant_id, id) ON DELETE CASCADE
);

ALTER TABLE audio_files
  ADD CONSTRAINT audio_files_active_analysis_fk
  FOREIGN KEY (tenant_id, id, active_analysis_revision_id)
  REFERENCES audio_analysis_revisions(tenant_id, audio_file_id, id);

CREATE INDEX audio_analysis_revisions_audio_created_idx
  ON audio_analysis_revisions (tenant_id, audio_file_id, created_at DESC);

CREATE TABLE analysis_scenes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  analysis_revision_id uuid NOT NULL,
  scene_index integer NOT NULL CHECK (scene_index > 0),
  title text NOT NULL,
  start_ms bigint NOT NULL CHECK (start_ms >= 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, analysis_revision_id, id),
  UNIQUE (tenant_id, analysis_revision_id, scene_index),
  FOREIGN KEY (tenant_id, analysis_revision_id)
    REFERENCES audio_analysis_revisions(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE transcript_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  analysis_revision_id uuid NOT NULL,
  scene_id uuid NOT NULL,
  segment_index integer NOT NULL CHECK (segment_index > 0),
  speaker_key text NOT NULL,
  speaker_label text NOT NULL,
  emotion text NOT NULL DEFAULT '',
  start_ms bigint NOT NULL CHECK (start_ms >= 0),
  end_ms bigint NOT NULL,
  text text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, analysis_revision_id, id),
  UNIQUE (tenant_id, analysis_revision_id, scene_id, segment_index),
  CHECK (end_ms > start_ms),
  FOREIGN KEY (tenant_id, analysis_revision_id, scene_id)
    REFERENCES analysis_scenes(tenant_id, analysis_revision_id, id) ON DELETE CASCADE
);

CREATE INDEX transcript_segments_timeline_idx
  ON transcript_segments (tenant_id, analysis_revision_id, start_ms, end_ms);

CREATE TABLE analysis_invalid_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  analysis_revision_id uuid NOT NULL,
  start_ms bigint NOT NULL CHECK (start_ms >= 0),
  end_ms bigint NOT NULL,
  reason text NOT NULL DEFAULT '',
  UNIQUE (tenant_id, analysis_revision_id, start_ms, end_ms),
  CHECK (end_ms > start_ms),
  FOREIGN KEY (tenant_id, analysis_revision_id)
    REFERENCES audio_analysis_revisions(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE analysis_summary_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  analysis_revision_id uuid NOT NULL,
  section_index integer NOT NULL CHECK (section_index > 0),
  title text NOT NULL,
  body text NOT NULL,
  UNIQUE (tenant_id, analysis_revision_id, section_index),
  FOREIGN KEY (tenant_id, analysis_revision_id)
    REFERENCES audio_analysis_revisions(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE segment_ai_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  analysis_revision_id uuid NOT NULL,
  transcript_segment_id uuid NOT NULL,
  title text NOT NULL,
  summary text NOT NULL,
  details jsonb NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE (tenant_id, transcript_segment_id),
  CHECK (
    jsonb_typeof(details) = 'array'
    AND NOT jsonb_path_exists(details, '$[*] ? (@.type() != "string")')
  ),
  FOREIGN KEY (tenant_id, analysis_revision_id)
    REFERENCES audio_analysis_revisions(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, analysis_revision_id, transcript_segment_id)
    REFERENCES transcript_segments(tenant_id, analysis_revision_id, id) ON DELETE CASCADE
);
