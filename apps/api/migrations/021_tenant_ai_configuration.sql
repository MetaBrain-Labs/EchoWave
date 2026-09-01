-- 建立租户级供应商、版本化能力绑定与加密 Credential 的权威配置边界。
CREATE TABLE credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  provider_type text NOT NULL CHECK (provider_type IN ('dashscope', 'deepseek', 'aliyun_oss')),
  name varchar(80) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

CREATE TABLE credential_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  credential_id uuid NOT NULL,
  version_no integer NOT NULL CHECK (version_no > 0),
  ciphertext bytea NOT NULL,
  iv bytea NOT NULL CHECK (octet_length(iv) = 12),
  auth_tag bytea NOT NULL CHECK (octet_length(auth_tag) = 16),
  key_version integer NOT NULL DEFAULT 1 CHECK (key_version > 0),
  masked_value varchar(32) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, credential_id, version_no),
  FOREIGN KEY (tenant_id, credential_id) REFERENCES credentials(tenant_id, id)
);

CREATE TABLE provider_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  provider_type text NOT NULL CHECK (provider_type IN ('dashscope', 'deepseek', 'aliyun_oss')),
  name varchar(80) NOT NULL,
  current_revision_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

CREATE TABLE provider_connection_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  provider_connection_id uuid NOT NULL,
  revision_no integer NOT NULL CHECK (revision_no > 0),
  config jsonb NOT NULL CHECK (jsonb_typeof(config) = 'object'),
  credential_source text NOT NULL CHECK (credential_source IN ('database', 'local_file')),
  credential_version_id uuid,
  local_credential_alias varchar(80),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, provider_connection_id, revision_no),
  FOREIGN KEY (tenant_id, provider_connection_id)
    REFERENCES provider_connections(tenant_id, id),
  FOREIGN KEY (tenant_id, credential_version_id)
    REFERENCES credential_versions(tenant_id, id),
  CHECK (
    (credential_source = 'database' AND credential_version_id IS NOT NULL AND local_credential_alias IS NULL)
    OR
    (credential_source = 'local_file' AND credential_version_id IS NULL AND local_credential_alias IS NOT NULL)
  )
);

ALTER TABLE provider_connections
  ADD CONSTRAINT provider_connections_current_revision_fk
  FOREIGN KEY (tenant_id, current_revision_id)
  REFERENCES provider_connection_revisions(tenant_id, id);

CREATE INDEX provider_connections_tenant_updated_idx
  ON provider_connections (tenant_id, updated_at DESC);

CREATE TABLE ai_capability_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  capability text NOT NULL CHECK (capability IN (
    'knowledge_embedding', 'knowledge_chat', 'audio_transcription', 'audio_emotion',
    'audio_role', 'business_analysis', 'audio_staging'
  )),
  current_revision_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, capability)
);

CREATE TABLE ai_capability_binding_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  binding_id uuid NOT NULL,
  revision_no integer NOT NULL CHECK (revision_no > 0),
  provider_revision_id uuid,
  secondary_provider_revision_id uuid,
  model varchar(160) NOT NULL,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(settings) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, binding_id, revision_no),
  FOREIGN KEY (tenant_id, binding_id) REFERENCES ai_capability_bindings(tenant_id, id),
  FOREIGN KEY (tenant_id, provider_revision_id)
    REFERENCES provider_connection_revisions(tenant_id, id),
  FOREIGN KEY (tenant_id, secondary_provider_revision_id)
    REFERENCES provider_connection_revisions(tenant_id, id)
);

ALTER TABLE ai_capability_bindings
  ADD CONSTRAINT ai_capability_bindings_current_revision_fk
  FOREIGN KEY (tenant_id, current_revision_id)
  REFERENCES ai_capability_binding_revisions(tenant_id, id);

CREATE TABLE configuration_imports (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  source text NOT NULL CHECK (source IN ('legacy_env')),
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, source)
);

ALTER TABLE document_revisions
  ADD COLUMN embedding_binding_revision_id uuid,
  ADD CONSTRAINT document_revisions_embedding_binding_revision_fk
    FOREIGN KEY (tenant_id, embedding_binding_revision_id)
    REFERENCES ai_capability_binding_revisions(tenant_id, id);

ALTER TABLE rag_runs
  ADD COLUMN embedding_binding_revision_id uuid,
  ADD COLUMN chat_binding_revision_id uuid,
  ADD CONSTRAINT rag_runs_embedding_binding_revision_fk
    FOREIGN KEY (tenant_id, embedding_binding_revision_id)
    REFERENCES ai_capability_binding_revisions(tenant_id, id),
  ADD CONSTRAINT rag_runs_chat_binding_revision_fk
    FOREIGN KEY (tenant_id, chat_binding_revision_id)
    REFERENCES ai_capability_binding_revisions(tenant_id, id);

ALTER TABLE audio_analysis_revisions
  ADD COLUMN transcription_binding_revision_id uuid,
  ADD COLUMN staging_binding_revision_id uuid,
  ADD CONSTRAINT audio_analysis_transcription_binding_revision_fk
    FOREIGN KEY (tenant_id, transcription_binding_revision_id)
    REFERENCES ai_capability_binding_revisions(tenant_id, id),
  ADD CONSTRAINT audio_analysis_staging_binding_revision_fk
    FOREIGN KEY (tenant_id, staging_binding_revision_id)
    REFERENCES ai_capability_binding_revisions(tenant_id, id);

ALTER TABLE audio_post_analysis_jobs
  ADD COLUMN capability_binding_revision_id uuid,
  ADD COLUMN staging_binding_revision_id uuid,
  ADD CONSTRAINT audio_post_analysis_binding_revision_fk
    FOREIGN KEY (tenant_id, capability_binding_revision_id)
    REFERENCES ai_capability_binding_revisions(tenant_id, id),
  ADD CONSTRAINT audio_post_analysis_staging_binding_revision_fk
    FOREIGN KEY (tenant_id, staging_binding_revision_id)
    REFERENCES ai_capability_binding_revisions(tenant_id, id);

ALTER TABLE audio_business_analysis_jobs
  ADD COLUMN chat_binding_revision_id uuid,
  ADD COLUMN embedding_binding_revision_id uuid,
  ADD CONSTRAINT audio_business_analysis_chat_binding_revision_fk
    FOREIGN KEY (tenant_id, chat_binding_revision_id)
    REFERENCES ai_capability_binding_revisions(tenant_id, id),
  ADD CONSTRAINT audio_business_analysis_embedding_binding_revision_fk
    FOREIGN KEY (tenant_id, embedding_binding_revision_id)
    REFERENCES ai_capability_binding_revisions(tenant_id, id);
