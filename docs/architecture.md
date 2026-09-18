# EchoWave Architecture

**English** | [简体中文](./architecture.zh-CN.md)

## RAG vertical slice

```text
Expo mobile ── validated JSON/multipart ──> Hono API
                                                │
               ┌────────────────────────────────┼────────────────────┐
               │                                │                    │
        PostgreSQL + pgvector          LangGraph workflows     DeepAgent nodes
        business source of truth       in-process workers      bounded tools only
               │                                │                    │
               └──── active revision + chunks ──┴──── HNSW ─────────┘
```

`@echowave/contracts` is the sole authority for JSON wire contracts. API producers and mobile consumers both perform Zod runtime validation. Clients never submit `tenant_id`; the fixed development tenant comes only from `apps/api/.env`.

## Modules and dependency direction

```text
apps/mobile/src/app
        │
        ▼
apps/mobile/src/features ──> apps/mobile/src/shared
        │                              │
        └──────── @echowave/contracts ◄┘

apps/api/src/bootstrap ──> http / knowledge / infrastructure / config / ai-observability
apps/api/src/http ───────> knowledge ──> answer / embeddings / ingestion / persistence
apps/api/src/http ───────> @echowave/contracts <──── apps/mobile/src/features
```

- Mobile `app` routes normalize parameters, bind navigation, and render screens. Features own business state; stable cross-feature facilities belong to `shared`.
- `@/*` maps to `apps/mobile/src/*`. `shared` never imports `features`, and one feature never shares infrastructure through another feature's internals.
- API `bootstrap` is the composition root; `http` handles transport, domain modules own use cases, and `infrastructure` exposes PostgreSQL facilities.
- `ai-observability` is a framework-independent side channel. Domain code depends on recorder ports, not Markdown-file implementations.
- `packages/contracts` is split by wire domain while its package root remains the compatibility export surface.

## Domain ownership

The API is domain-first and layered inside each domain:

```text
apps/api/src/
  bootstrap/       composition, runtime factories, seed, startup, shutdown
  config/          HTTP, database, Redis, model, audio, report configuration
  http/            app, error mapping, SSE, domain routes
  ai-runtime/      structured-output and model-call lifecycle primitives
  notifications/   Expo Push outbox, receipts, device invalidation
  knowledge/
    catalog/       knowledge bases, documents, chunks
    retrieval/     retrieval ports and vector implementation
    answer/        grounded-answer Agent
    ingestion/     ingestion workflow, worker, persistence
  workspace/
    groups/        GroupService and repository
    data-sources/  DataSourceService and repository
    audio/
      core/        playback, details, confirmation, AudioService
      transcription/  repository, provider, workflow, worker
      post-analysis/  emotion/role context, provider, worker
      business-analysis/  context, LangGraph, repository, worker
      execution/   query port, recorder, event mapping, repository
```

Composition files stay small. Routes depend on explicit service ports; services depend directly on narrow repositories. Repositories own SQL and transactions, services own use-case coordination, routes own network parsing/status, and workers own claim/recovery/shutdown lifecycles. LangGraph workflows use `state.ts`, `nodes.ts`, and `graph.ts`; every node is named and dependencies enter through factories or runtime context. Each model task owns one nearby `CONTEXT.ts` containing only prompts and dynamic context builders.

Mobile features likewise own state and presentation. Screens compose, complex loading/subscription/confirmation behavior belongs in feature hooks, and components/styles remain inside the feature. `shared/api` is resource-oriented and shares only foundational request behavior.

### Runtime Server connection

A gate outside business navigation owns the Server connection. Versioned AsyncStorage stores only a health-verified normalized origin and six per-Server onboarding states, never business data. Saved addresses override the Development/Expo Go `EXPO_PUBLIC_API_URL`; Production profiles require runtime selection.

Without a valid origin, business routes are not mounted and send no requests. `GET /health` is parsed through `HealthResponseSchema`. REST, uploads, SSE, media, and push registration resolve the same runtime origin. Switching Server stops old SSE connections, increments a connection revision, and remounts navigation to discard page caches. LAN HTTP is limited to local/private/link-local/`.local` addresses; public origins require HTTPS.

## Data and publication boundaries

- PostgreSQL is authoritative for knowledge, documents, revisions, chunks, tasks, conversations, audit runs, groups, data sources, audio metadata, runtime/storage bindings, ASR runs, checkpoints, and published analysis.
- Audio binaries and third-party secrets do not enter business tables. Hybrid stores source audio in `AUDIO_STORAGE_DIR`; object storage uses presigned PUT to authoritative OSS; lightweight local streams into temporary storage and deletes after work completes.
- Stable tenant-scoped content routes serve playback. Object assets are proxied with Range support; cleaned source returns an explicit unavailable state without affecting published transcripts or analyses.
- Raw provider transcript text is immutable. Confirmed Transcripts are complete immutable snapshots selected by an active pointer and are the sole downstream text-analysis input.
- Every publication writes all generated rows before moving the active pointer in the same transaction. Failure leaves the previous revision online.
- Tenant SQL always includes `tenant_id`; retrieval additionally constrains the knowledge base and active document revision.
- Workers claim through `FOR UPDATE SKIP LOCKED`, leases, and idempotent keys. PostgreSQL `LISTEN/NOTIFY` accelerates wakeups while 15-second scans recover missed notifications; task tables remain authoritative.
- Group visibility unions explicit audio shares with linked active data sources. Counts are derived, not writable page fields. Archive operations are soft and preserve historical facts.
- The starter-template installer writes its marker, two groups, one shared upload source, and relationships in one transaction. Reruns never recreate archived items or overwrite user settings.
- Business analysis uses durable LangGraph `prepare → plan_retrieval → parallel retrieve_query → deep_agent → validate → publish`. Serializable checkpoints hold workflow state; repositories, models, and recorders enter through runtime context.
- The current release supports one API instance. PostgreSQL state is durable, but mobile SSE wakeups are still process-local and local audio paths are not multi-instance safe.

### Why native PostgreSQL remains

The hot path relies on pgvector `vector(1024)`, cosine HNSW, session-level retrieval parameters, `FOR UPDATE SKIP LOCKED`, partial indexes, dynamic schema qualifiers, and multi-table transactional publication. A second ORM would still require native SQL for these paths and would create two persistence models. EchoWave therefore keeps `pg` and explicit ordered migrations authoritative until ordinary relational CRUD growth clearly justifies that cost.

## Model and Agent boundaries

- DashScope `qwen3.7-text-embedding` produces fixed 1024-dimensional dense vectors, batches up to 20 documents, and distinguishes document/query input.
- `qwen-audio-3.0-asr-flash-filetrans` uses `speaker_turn` with explicit `silero_vad` or `whole_file` preprocessing. VAD never silently falls back; manifests, provider task IDs, temporary object keys, and checkpoints support restart-safe completion.
- ASR context and instant vocabulary are merged from tenant defaults, data-source hotwords, and explicit task overrides, then frozen in the transcription revision. Existing results are reused unless an override explicitly requests a new transcription version; sensitive-word filtering remains disabled for the current product policy.
- Qwen Filetrans output requires non-empty sentences with `speaker_id` and ordered valid millisecond timestamps. Missing/overlapping/invalid output fails as `INVALID_MODEL_OUTPUT`; it is not guessed or silently repaired through another model.
- `qwen3.5-omni-flash` handles per-segment acoustic emotion through the Beijing OpenAI-compatible endpoint and signed OSS URLs. Results must cover each target and include the fixed emotion enum, confidence, and acoustic cues.
- `deepseek-v4-flash` performs non-thinking JSON role recognition, grounded answers, speaker review, and business analysis under task-specific schemas.
- Retrieval uses cosine HNSW with `ef_search=100`, initial top 30, deduplication/document quotas, and at most 8 chunks or 12,000 characters for the Agent.
- DeepAgent has no filesystem, skills, long-term memory, or subagents. Its only business tool is tenant-scoped `search_knowledge`, with at most four executions per turn.
- The Server accepts citations only from the current retrieval allowlist. Insufficient evidence returns `grounded=false`; common knowledge cannot fill the gap. Eight citations is prompt guidance, not a Server truncation threshold: every allowlist-valid citation is returned, because a `[9]` marker denotes a real ninth source and trimming it would silently delete evidence. Citation correction runs only for IDs outside the allowlist and may replace those IDs, never shorten the answer or break the marker-to-citation mapping. Markers map to citation order, so the Server renumbers them sequentially and removes a marker only when it exceeds the retained citation count. The mobile client shows four citations by default and expands the complete list on demand.

### Why knowledge answers are not streamed yet

The answer boundary completes `DeepAgent invoke → JSON recovery/correction → citation allowlist validation → usage aggregation → run audit` before returning one `RagQueryResponseSchema` JSON response. Streaming would need a product event contract separating provisional text, final citations, usage, cancellation, and failure, including the case where displayed text later fails citation validation. It must not be implemented by simply replacing `invoke` and bypassing trust checks.

The mobile progress card is client interaction feedback, not server telemetry. Only the final result contains verified sources. The read-only recent-history endpoint returns up to six completed summaries from `rag_runs`; it does not revive them as editable conversations.

The query screen and history panel render each `[n]` in the answer as a tappable marker: tapping it expands the collapsed citation area, scrolls the container to the matching citation card, and highlights that card temporarily. Offsets come from measured card heights rather than assumed ones. Tapping a citation card still only opens the citation snapshot modal and never navigates to the source document; only the modal's explicit action opens the original location.

## AI execution diagnostics

Product audit in `ai_execution_runs` and `ai_execution_events` is always enabled but intentionally limited to safe stage, model-statistic, tool-name, retrieval-query, knowledge-base, and source-location facts. It excludes prompts, model output, chunk text, and hidden reasoning. Local Markdown diagnostics are separate, disabled by default, and may contain more development detail only under explicit switches.

Optional reports are post-run diagnostics, never the source for progress, HTTP responses, or recovery. Disabled reporters are no-op; write failures emit only redacted warnings and never change business results. The separate raw STT response switch records bounded and redacted provider responses, never request audio, authorization headers, or full response headers. Report directories are Git-ignored and are not automatically cleaned.

## Configuration and security

- `apps/api/.env` is the API's sole startup source; migrations and LangGraph setup run only through the explicit migration command.
- `apps/mobile/.env` contains public development defaults only. Production selects the Server at runtime.
- `/health.capabilities.remotePush` gates notification permissions and device registration. Self-hosted defaults off and requires a native Build plus EAS/Firebase or Apple/APNs credentials when enabled.
- The sole EAS configuration is `apps/mobile/eas.json`; user-visible SemVer remains synchronized with API and Release metadata.
- The API does not log full user text, model context, raw provider errors, or reasoning by default. Secrets are never loggable.
- Redis remains a future cache/coordination boundary and is not a second source of truth.

## Knowledge document updates and deletion

Document writes allocate a monotonic version and immutable revision input. The latest requested revision may publish only while its ingestion lease remains valid and both the document and knowledge base are live. Replacements and title changes retain the previous active revision until all chunks and embeddings are ready. Titles remain part of embedding input.

Deletion commits the document tombstone and durable cleanup tasks together. Retrieval checks tenant, knowledge-base ownership, document lifecycle, active revision and embedding model. PostgreSQL chunks include vectors; the cleanup worker removes them and the version's local original file with retries. Historical document/revision records and AI results remain.

RAG runs and business analyses persist title, quote and locator snapshots. Citation reads use those snapshots and derive source status from document/revision audit records, so cleanup cannot erase historical evidence. Business-analysis fingerprints include knowledge content versions; knowledge changes mark historical results stale and require a new analysis input instead of resuming old evidence.

## Semantic knowledge categories and scoped retrieval

Migration `040_knowledge_categories.sql` adds tenant category catalogues, knowledge-base defaults, revision-level document and worksheet overrides, model suggestions and confirmation history. Confirmed worksheet overrides take precedence over document overrides and knowledge-base defaults. Suggestions do not change effective categories before confirmation. Collection folders remain provenance organization; projected cases inherit the destination knowledge-base default.

The ingestion Graph's `classify` node reuses `knowledge_chat` for one bounded suggestion request, fairly sampling every worksheet within a 12000-character content budget. Persisted suggestions survive ingestion retries; classification failures do not block vector publication. Existing documents request suggestions explicitly. Renames inherit their source revision classification; file replacements do not.

Question-answering selects up to three categories through the existing search tool, while mobile users may select any number of categories explicitly with no upper bound; both paths share the same server-side validation. The retrieval scope is a knowledge-base set: the routed base always participates, the request may add other bases of the same tenant, and the server validates existence and tenant ownership for each one — if any base is unavailable the whole request is rejected instead of silently narrowing the scope. A single base keeps the original recall and context budget while multiple bases use the cross-base global quota, and the category catalogue is the union of every base, so the client groups categories by knowledge base. Business analysis extends its existing planning request with category choices. The server validates choices within the current or linked knowledge-base whitelist and applies SQL category filters alongside tenant, document lifecycle, active revision and embedding-model checks. Ordinary factual tasks exclude classified test fixtures.

Entering Q&A from the group top bar preselects every active category of all linked knowledge bases (inactive categories never join the default filter); the user may add or remove categories and may exclude a whole knowledge base from the scope in the category panel. When the catalogue fails to load the client falls back to automatic routing instead of blocking the question. **Each entry is one chat**: the entry point carries a fresh `session` parameter, which remounts the screen and clears memory, and once that chat sends its first question the retrieval categories and knowledge-base scope freeze with a notice that leaving and re-entering is required to change them. Later questions in the same chat keep the multi-turn memory. Conversations and runs record the effective scope in `knowledge_base_ids`, while the conversation stays anchored to the primary base for history listing and expiry cleanup.

Automatic routing shares one expansion for zero hits or insufficient evidence, reusing query embeddings. Explicit filters never expand. Question-answering retains its four-search budget; business analysis shares five SQL searches across up to three proactive and two supplemental searches, including expansion. Business budgets and expansion flags survive recovery and parallel branches. Knowledge content versions cover classification/catalogue changes so stale analysis cannot publish.

Multi-turn context keeps only the last six question-and-final-answer pairs: `search_knowledge` tool messages and tool-call messages from earlier turns are removed before the next question. Historical passages are not part of the current citation allowlist, and leaving them in context makes the model restate and cite content from a different knowledge base. When retrieval does return allowlist-valid passages but the candidate still cites nothing, the answer module runs one grounding rescue over those passages before falling back to the stable refusal.

`/api/knowledge-categories` supports creation and versioned maintenance without hard deletion. `/api/knowledge-bases/:knowledgeBaseId/categories` lists retrievable categories. Document `classification` resources read/confirm overrides; `classification/suggest` requests suggestions. Query requests accept optional `categoryIds`. Metadata updates preserve text, embeddings, content hashes and historical citation snapshots.

The category index complements HNSW iterative scans. Fewer irrelevant results do not imply proportional scan-cost reductions; verify with isolated fixtures and query plans.
