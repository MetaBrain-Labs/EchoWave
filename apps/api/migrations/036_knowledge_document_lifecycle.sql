-- 文档版本、持久原文件、租约隔离和历史证据快照；回填完成后才允许清理知识块。
ALTER TABLE knowledge_bases ADD COLUMN content_version integer NOT NULL DEFAULT 0;
ALTER TABLE documents ADD COLUMN version integer NOT NULL DEFAULT 0,
  ADD COLUMN latest_revision_id uuid;
ALTER TABLE document_revisions ADD COLUMN version integer,
  ADD COLUMN title text, ADD COLUMN format text, ADD COLUMN size_bytes bigint,
  ADD COLUMN storage_key text, ADD COLUMN rebuild_snapshot jsonb,
  ADD COLUMN cleaned_at timestamptz;
WITH numbered AS (
  SELECT id, row_number() OVER (PARTITION BY tenant_id, document_id ORDER BY created_at, id)::int AS version
  FROM document_revisions
)
UPDATE document_revisions r SET version = n.version, title = d.title,
  format = d.format, size_bytes = d.size_bytes
FROM numbered n, documents d WHERE r.id = n.id AND d.id = r.document_id AND d.tenant_id = r.tenant_id;
ALTER TABLE document_revisions ALTER COLUMN version SET NOT NULL,
  ALTER COLUMN title SET NOT NULL, ALTER COLUMN format SET NOT NULL,
  ALTER COLUMN size_bytes SET NOT NULL;
DROP INDEX document_revision_hash_idx;
CREATE UNIQUE INDEX document_revision_version_idx ON document_revisions(tenant_id, document_id, version);
ALTER TABLE document_revisions ADD CONSTRAINT document_revision_owner_unique UNIQUE(tenant_id, document_id, id);
UPDATE documents d SET version = r.version, latest_revision_id = r.id
FROM document_revisions r WHERE r.document_id = d.id AND r.tenant_id = d.tenant_id
  AND r.version = (SELECT max(version) FROM document_revisions WHERE document_id = d.id AND tenant_id = d.tenant_id);
ALTER TABLE documents ADD CONSTRAINT documents_latest_revision_fk
  FOREIGN KEY(tenant_id, id, latest_revision_id) REFERENCES document_revisions(tenant_id, document_id, id);
ALTER TABLE documents DROP CONSTRAINT documents_active_revision_fk;
ALTER TABLE documents ADD CONSTRAINT documents_active_revision_fk
  FOREIGN KEY(tenant_id, id, active_revision_id) REFERENCES document_revisions(tenant_id, document_id, id);
ALTER TABLE documents DROP CONSTRAINT documents_status_check;
ALTER TABLE documents ADD CONSTRAINT documents_status_check CHECK(status IN
  ('queued','validating','parsing','chunking','embedding','ready','failed','deleting','deleted'));
UPDATE documents SET status = 'deleted' WHERE deleted_at IS NOT NULL;
ALTER TABLE document_revisions DROP CONSTRAINT document_revisions_status_check;
ALTER TABLE document_revisions ADD CONSTRAINT document_revisions_status_check
  CHECK(status IN ('processing','ready','failed','inactive','superseded'));
ALTER TABLE ingestion_jobs ADD COLUMN lease_token uuid, ADD COLUMN progress smallint NOT NULL DEFAULT 0;
ALTER TABLE ingestion_jobs DROP CONSTRAINT ingestion_jobs_status_check;
ALTER TABLE ingestion_jobs ADD CONSTRAINT ingestion_jobs_status_check
  CHECK(status IN ('queued','running','completed','failed','cancelled'));
UPDATE documents d SET status = 'ready' WHERE deleted_at IS NULL AND active_revision_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM document_revisions r WHERE r.id = d.active_revision_id AND r.status = 'ready');

ALTER TABLE business_analysis_citations ADD COLUMN revision_id uuid,
  ADD COLUMN quote_snapshot text NOT NULL DEFAULT '';
UPDATE business_analysis_citations citation SET revision_id = chunk.revision_id,
  quote_snapshot = chunk.content
FROM document_chunks chunk WHERE chunk.tenant_id = citation.tenant_id AND chunk.id = citation.chunk_id;
ALTER TABLE business_analysis_citations DROP CONSTRAINT business_analysis_citations_tenant_id_chunk_id_fkey;
ALTER TABLE rag_runs ADD COLUMN citation_snapshots jsonb NOT NULL DEFAULT '[]'::jsonb;
UPDATE rag_runs run SET citation_snapshots = coalesce((
  SELECT jsonb_agg(jsonb_build_object('number', source.ordinality,
    'knowledgeBaseId', chunk.knowledge_base_id, 'documentId', chunk.document_id,
    'revisionId', chunk.revision_id, 'documentTitle', document.title,
    'chunkId', chunk.id, 'quoteSnapshot', chunk.content,
    'excerpt', left(chunk.content, 320), 'locator', chunk.locator) ORDER BY source.ordinality)
  FROM jsonb_array_elements_text(run.cited_chunk_ids) WITH ORDINALITY source(chunk_id, ordinality)
  JOIN document_chunks chunk ON chunk.id::text = source.chunk_id AND chunk.tenant_id = run.tenant_id
  JOIN documents document ON document.id = chunk.document_id AND document.tenant_id = chunk.tenant_id
), '[]'::jsonb) WHERE status = 'completed';
ALTER TABLE audio_business_analysis_jobs ADD COLUMN knowledge_version_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE knowledge_cleanup_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
  knowledge_base_id uuid NOT NULL REFERENCES knowledge_bases(id), document_id uuid NOT NULL REFERENCES documents(id),
  revision_id uuid NOT NULL REFERENCES document_revisions(id),
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','failed')),
  stage text NOT NULL DEFAULT 'chunks' CHECK(stage IN ('chunks','files','done')),
  storage_key text, staged_path text, attempts integer NOT NULL DEFAULT 0,
  lease_token uuid, lease_until timestamptz, next_attempt_at timestamptz NOT NULL DEFAULT now(),
  error_code text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, revision_id)
);
CREATE INDEX knowledge_cleanup_claim_idx ON knowledge_cleanup_jobs(tenant_id, status, next_attempt_at, lease_until);
CREATE TRIGGER knowledge_cleanup_worker_notify AFTER INSERT OR UPDATE ON knowledge_cleanup_jobs
  FOR EACH ROW EXECUTE FUNCTION notify_echowave_worker_job('knowledge-cleanup');
-- 旧部署中的非活动版本也需要清理，但不能清理最新仍可重试的修改。
INSERT INTO knowledge_cleanup_jobs(tenant_id, knowledge_base_id, document_id, revision_id, staged_path)
SELECT r.tenant_id, d.knowledge_base_id, d.id, r.id, j.staged_path
FROM document_revisions r JOIN documents d ON d.tenant_id = r.tenant_id AND d.id = r.document_id
LEFT JOIN ingestion_jobs j ON j.tenant_id = r.tenant_id AND j.revision_id = r.id
WHERE d.deleted_at IS NOT NULL OR (r.id IS DISTINCT FROM d.active_revision_id AND r.id IS DISTINCT FROM d.latest_revision_id)
ON CONFLICT DO NOTHING;
UPDATE ingestion_jobs j SET status = 'cancelled', lease_token = NULL, lease_until = NULL
FROM documents d WHERE d.tenant_id = j.tenant_id AND d.id = j.document_id
  AND (d.deleted_at IS NOT NULL OR j.revision_id IS DISTINCT FROM d.latest_revision_id)
  AND j.status IN ('queued','running','failed');
