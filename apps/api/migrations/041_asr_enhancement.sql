-- 为租户默认 ASR 上下文和数据源热词建立可恢复的权威配置。
CREATE TABLE asr_preferences (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  default_context text NOT NULL DEFAULT '',
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE data_sources
  ADD COLUMN asr_hotwords jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(asr_hotwords) = 'array');
