-- 业务分析长转写分层窗口的幂等 checkpoint。
CREATE TABLE IF NOT EXISTS audio_business_analysis_windows (
  tenant_id uuid NOT NULL,
  job_id uuid NOT NULL,
  window_index integer NOT NULL CHECK (window_index >= 0),
  start_ms bigint NOT NULL CHECK (start_ms >= 0),
  end_ms bigint NOT NULL CHECK (end_ms > start_ms),
  segment_ids uuid[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'ready', 'failed')),
  result jsonb,
  attempt smallint NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (tenant_id, job_id, window_index),
  FOREIGN KEY (tenant_id, job_id)
    REFERENCES audio_business_analysis_jobs(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS audio_business_analysis_windows_status_idx
  ON audio_business_analysis_windows (tenant_id, job_id, status, window_index);

CREATE TABLE IF NOT EXISTS audio_post_analysis_windows (
  tenant_id uuid NOT NULL,
  job_id uuid NOT NULL,
  window_index integer NOT NULL CHECK (window_index >= 0),
  start_ms bigint NOT NULL CHECK (start_ms >= 0),
  end_ms bigint NOT NULL CHECK (end_ms > start_ms),
  segment_ids uuid[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'ready', 'failed')),
  result jsonb,
  attempt smallint NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (tenant_id, job_id, window_index),
  FOREIGN KEY (tenant_id, job_id)
    REFERENCES audio_post_analysis_jobs(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS audio_post_analysis_windows_status_idx
  ON audio_post_analysis_windows (tenant_id, job_id, status, window_index);
