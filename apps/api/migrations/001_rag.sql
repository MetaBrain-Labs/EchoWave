CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;

CREATE TABLE tenants (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE knowledge_bases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name varchar(120) NOT NULL,
  description varchar(1000) NOT NULL DEFAULT '',
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX knowledge_bases_tenant_updated_idx
  ON knowledge_bases (tenant_id, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  knowledge_base_id uuid NOT NULL REFERENCES knowledge_bases(id),
  title text NOT NULL,
  format text NOT NULL CHECK (format IN ('markdown', 'word', 'spreadsheet')),
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  status text NOT NULL CHECK (status IN ('queued', 'validating', 'parsing', 'chunking', 'embedding', 'ready', 'failed', 'deleting')),
  progress smallint NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  error_code text,
  error_message text,
  error_retryable boolean,
  active_revision_id uuid,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX documents_library_idx
  ON documents (tenant_id, knowledge_base_id, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE document_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  document_id uuid NOT NULL REFERENCES documents(id),
  source_sha256 char(64) NOT NULL,
  parser_version text NOT NULL,
  embedding_model text NOT NULL,
  embedding_dimensions integer NOT NULL CHECK (embedding_dimensions = 1024),
  embedding_provider text,
  embedding_tokens integer NOT NULL DEFAULT 0,
  embedding_cost_usd numeric(14, 8) NOT NULL DEFAULT 0,
  preview_text text NOT NULL DEFAULT '',
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL CHECK (status IN ('processing', 'ready', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);

ALTER TABLE documents
  ADD CONSTRAINT documents_active_revision_fk
  FOREIGN KEY (active_revision_id) REFERENCES document_revisions(id);

CREATE UNIQUE INDEX document_revision_hash_idx
  ON document_revisions (tenant_id, document_id, source_sha256);

CREATE TABLE document_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  knowledge_base_id uuid NOT NULL REFERENCES knowledge_bases(id),
  document_id uuid NOT NULL REFERENCES documents(id),
  revision_id uuid NOT NULL REFERENCES document_revisions(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL CHECK (chunk_index > 0),
  title text NOT NULL,
  heading_path jsonb NOT NULL DEFAULT '[]'::jsonb,
  content text NOT NULL,
  embedding_text text NOT NULL,
  content_sha256 char(64) NOT NULL,
  locator jsonb NOT NULL,
  embedding_model text NOT NULL,
  embedding vector(1024) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (revision_id, chunk_index)
);

CREATE INDEX document_chunks_scope_idx
  ON document_chunks (tenant_id, knowledge_base_id, document_id, revision_id);

CREATE INDEX document_chunks_embedding_hnsw
  ON document_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE TABLE ingestion_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  knowledge_base_id uuid NOT NULL REFERENCES knowledge_bases(id),
  document_id uuid NOT NULL REFERENCES documents(id),
  revision_id uuid NOT NULL REFERENCES document_revisions(id),
  staged_path text,
  stage text NOT NULL DEFAULT 'validate',
  status text NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  lease_until timestamptz,
  error_code text,
  error_message text,
  error_retryable boolean,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ingestion_jobs_claim_idx
  ON ingestion_jobs (status, lease_until, created_at);

CREATE TABLE rag_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  knowledge_base_id uuid NOT NULL REFERENCES knowledge_bases(id),
  thread_id uuid NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rag_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  knowledge_base_id uuid NOT NULL REFERENCES knowledge_bases(id),
  conversation_id uuid NOT NULL REFERENCES rag_conversations(id) ON DELETE CASCADE,
  question text NOT NULL,
  answer text,
  grounded boolean,
  cited_chunk_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  embedding_tokens integer NOT NULL DEFAULT 0,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  embedding_model text NOT NULL,
  chat_model text NOT NULL,
  chat_provider text,
  duration_ms integer,
  status text NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
