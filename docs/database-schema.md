# EchoWave Database Schema

**English** | [简体中文](./database-schema.zh-CN.md)

This document describes the current PostgreSQL/pgvector business schema and lifecycle. Ordered SQL under `apps/api/migrations` is authoritative; this document explains relationships and invariants rather than replacing migrations.

## Database boundary

- PostgreSQL is authoritative for tenant business data, configuration revisions, knowledge, workflows, transcripts, analyses, and audit facts.
- Audio binaries live in controlled local storage or OSS according to runtime mode; provider secrets live in a Credential Provider. Neither belongs in ordinary business tables.
- Every business access path is tenant-scoped. The client never supplies `tenant_id`; the Server injects the fixed development tenant.
- Rows use UUID identities and timestamps. User-visible deletion is generally soft archival; immutable revisions and audit history are retained.
- pgvector provides dense `vector(1024)` embeddings and cosine HNSW retrieval.

## Core relationships

```text
tenants
 ├─ credentials ─ credential_versions
 ├─ provider_connections ─ provider_connection_revisions
 ├─ ai_capability_bindings ─ ai_capability_binding_revisions
 ├─ knowledge_bases
 │   └─ documents ─ document_revisions ─ document_chunks
 │                     └─ ingestion_jobs
 │   └─ rag_conversations ─ rag_runs
 ├─ groups
 │   ├─ group_knowledge_bases ─ knowledge_bases
 │   ├─ group_data_sources ─ data_sources
 │   └─ group_audio_links ─ audio_files
 ├─ data_sources ─ data_source_ingestion_runs
 ├─ tenant_audio_runtime_settings
 ├─ audio_files ─ audio_upload_sessions
 │   └─ audio_analysis_revisions
 │       ├─ transcript_segments
 │       ├─ transcript_confirmations ─ transcript_confirmation_segments
 │       ├─ audio_speaker_review_jobs ─ speaker_review_findings
 │       ├─ audio_post_analysis_jobs/windows/results
 │       ├─ audio_business_analysis_jobs/windows/results
 │       └─ ai_execution_runs ─ ai_execution_events
 └─ audio_analysis_batches ─ audio_analysis_tasks/blockers
     └─ notification_events ─ notification_deliveries
```

## Tenant and migration management

### `tenants`

Defines the tenant boundary. The current product seeds one development tenant but retains tenant keys on business tables so later account/RBAC work does not require collapsing unrelated organizations.

### `schema_migrations`

Records successfully applied three-digit migrations. The migration runner applies files in deterministic order and never treats the presence of tables as a substitute for recorded migration state. `001_rag.sql` installs `vector` in `public` when absent.

### `starter_template_installations`

Stores the installed starter-catalog version per tenant. The provisioner writes the marker and catalog relationships atomically, and never recreates archived items or overwrites later user settings.

## Tenant AI configuration

### `credentials` and `credential_versions`

`credentials` identifies a tenant/provider secret. Each change creates an immutable encrypted `credential_versions` row. Ciphertext uses AES-256-GCM with version-bound AAD; plaintext is never returned.

### `provider_connections` and `provider_connection_revisions`

A stable connection identity points to immutable revisions containing provider type, HTTPS Base URL, model-independent config, credential source/version or Local alias, and availability status. Tasks freeze the revision they were created with.

### `ai_capability_bindings` and `ai_capability_binding_revisions`

Stable capability identities bind knowledge embedding/chat, transcription, emotion, role, speaker review, business analysis, staging, and primary storage to a provider revision plus model/backend settings. Publication creates a revision rather than mutating task history.

### `configuration_imports`

Makes legacy environment import idempotent and records when database configuration became authoritative for a tenant without exposing imported values.

## Knowledge and RAG

### `knowledge_bases`

Stores tenant knowledge-base identity, name/description, archive state, and read-only storage/index/model/parse settings. Document and size totals are derived from active document facts rather than written counters.

### `documents`

Stable source identity, filename/media type/size, ingestion status, archive state, and pointer to the current successful revision. Upload is not a revision by itself.

### `document_revisions`

Immutable parse/publication attempt with content hash, parser/model facts, status, error metadata, and lifecycle timestamps. A successful transaction moves the document's active pointer only after all chunks and vectors exist.

### `document_chunks`

Tenant-, knowledge-, document-, and revision-scoped evidence text with ordinal, source locator, token/character facts, and `vector(1024)` embedding. Unique revision/ordinal keys make retries idempotent. HNSW cosine search is restricted to the current active revision.

### `ingestion_jobs`

Durable queue rows with lease, attempts, retry schedule, progress, and error facts. Workers claim through `FOR UPDATE SKIP LOCKED`; success publishes the revision atomically and failure leaves the old revision active.

### `rag_conversations` and `rag_runs`

Conversations hold bounded multi-turn context in one knowledge base. Runs audit one question, final grounded answer, validated citations, usage, status, and errors. Recent history reads only completed run summaries and does not revive old conversations.

## Groups and relationships

### `groups`

Tenant workspace identity, name, analysis settings, timestamps, and soft archive state. Counts are aggregated from relationships and active resources.

### `group_knowledge_bases`

Many-to-many link inserted through an atomic tenant-scoped batch. Duplicate links are idempotent; any unavailable requested group aborts the entire write.

### `group_data_sources`

Connects active data sources to groups. An archived source is excluded from active visibility and counts without deleting historical links.

### `group_audio_links`

Explicit audio sharing. Group-visible audio is the deduplicated union of this table and audio inherited through linked active data sources.

## Data sources and imports

### `data_sources`

Stable business source with tenant identity, type, display metadata, analysis-language and role settings, status, archive state, and timestamps. Provider credentials are never stored on the source.

### `data_source_ingestion_runs`

Audits source import/upload runs, their status, counters, trigger, error, and lifecycle without replacing individual audio/document facts.

## Audio runtime and upload

### `tenant_audio_runtime_settings`

Stores the current tenant mode and configuration revision. Mode changes affect only later assets.

### `audio_files`

Stable tenant audio metadata including source ownership, filename/media/size/hash/duration, creation-time runtime mode, storage backend/key/binding revision, retention/cleanup state, archive state, and active analysis pointers. It never stores the binary.

### `audio_upload_sessions`

Resumable upload handshake with expected size/hash, mode/backend, object or local target, expiry, completion, and failure facts. Completion validates the frozen fingerprint before publishing the audio asset.

## Audio analysis

### `audio_analysis_revisions`

One versioned ASR pipeline attempt, also serving as the durable transcription queue. It freezes model/provider/binding, preprocessing mode, provider task ID, temporary object, VAD manifest, ordered checkpoints, progress, retries, errors, transcript publication, active confirmation, post-analysis pointers, and source cleanup.

Only one live transcription revision per audio is allowed. `FOR UPDATE SKIP LOCKED`, persisted provider deadlines, and checkpoints prevent duplicate submission and resume Polling or EventBridge completion after restart.

### `transcript_segments`

Immutable Raw Transcript segments with ordered source time, provider speaker, text, word timestamps, and compatibility projections. Provider text is never overwritten by confirmation.

### `transcript_confirmations` and `transcript_confirmation_segments`

Complete immutable user-confirmed snapshots. Publication verifies the entire segment set and advances the active pointer. Downstream text analysis reads only the selected confirmation.

### Speaker review and post-analysis

- `audio_speaker_review_jobs` and `speaker_review_findings` store revision-scoped candidate boundary reviews and their resolution.
- `audio_post_analysis_jobs` coordinates emotion and role stages.
- `audio_post_analysis_windows` stores bounded acoustic work windows and retry state.
- `segment_emotion_results` stores fixed emotion, confidence, and acoustic evidence per segment.
- `speaker_role_results` stores one allowed role and evidence per observed speaker.

Results are versioned and published through revision pointers; a failure or rerun never overwrites an older result.

### Group business analysis

- `group_analysis_settings` stores the group's versioned template/role configuration.
- `audio_business_analysis_jobs` is the durable status, progress, retry, checkpoint-thread, and error authority.
- `audio_business_analysis_windows` stores long-transcript window results so resume reruns only the earliest incomplete window.
- `audio_group_business_analysis_heads` selects the current published result per audio/group.
- `business_analysis_summary_sections` and structured tag/evidence tables store the immutable report publication.

Publication writes summary, tags, evidence, and head in one transaction. Repeating publication for the same successful head is idempotent.

## Batch automation and push

- `audio_analysis_batches`: one 1–20 item request with data source, group, schedule, stage switches, aggregate status, and warnings.
- `audio_analysis_tasks`: per-audio stage state, source provenance (`created/reused/skipped/unavailable/unknown`), attempts, blockers, cancellation, and terminal result.
- `audio_analysis_batch_blockers`: capability-level hard blockers and resume facts.
- `push_devices`: tenant/device/platform Expo token registration and active state.
- `notification_events`: transactional outbox event without secret or user body.
- `notification_deliveries`: ticket/receipt attempts, retry, provider error code, and device invalidation.

Task state remains authoritative; push is a hint that causes the App to reload state.

## Structured analysis and execution audit

- `analysis_scenes`: versioned scene boundaries and summaries.
- `analysis_invalid_segments`: explicit quality failures rather than invented output.
- `analysis_summary_sections` and `segment_ai_tags`: structured published summaries/tags.
- `ai_execution_runs`: one ASR/model/worker execution with safe model, timing, usage, and terminal status.
- `ai_execution_events`: ordered safe step/tool/retrieval/progress facts. It excludes prompts, raw model content, knowledge text, secrets, and hidden reasoning.

## LangGraph checkpoint schema

`echowave_graph` is managed through LangGraph setup and contains `checkpoint_migrations`, `checkpoints`, `checkpoint_blobs`, and `checkpoint_writes`. Checkpoints are serialized workflow-resume state, not the business status authority. Successful/finally failed jobs remove their thread; startup compensation removes orphaned checkpoints.

## Lifecycle invariants

### Tenant isolation

Repositories include tenant keys in reads and writes. Relationship writes verify both sides inside the same tenant. Clients cannot choose a tenant through request payloads.

### Deletion

Groups, knowledge bases, documents, and data sources use soft archival where history matters. Material temporary objects are cleaned through explicit lifecycle/compensation. Destructive volume/database removal is an operator action outside normal product deletion.

### Revision publication

Create immutable work, validate completeness, then move one active pointer in the same transaction. Failed work remains auditable and never takes the previous successful version offline.

### Dynamic aggregation

UI totals, visible audio, document counts, sizes, and status summaries are derived from authoritative rows and relationships. Page mock fields are never persisted as competing counters.
