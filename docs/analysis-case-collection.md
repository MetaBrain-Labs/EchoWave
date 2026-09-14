# Analysis Case Collection and Audio Learning

**English** | [简体中文](./analysis-case-collection.zh-CN.md)

This release connects analysis results to candidates, human review or direct publication, knowledge retrieval, and original audio learning. It reuses the shared workspace and existing ingestion pipeline without new AI extraction tasks or account permissions. Categories organize cases; a strength category alone does not certify quality.

## Product flow

1. Create a target knowledge base, then open Knowledge collection in group settings. Each rule requires a target. The default mode collects candidates for human review; direct publication and manual-only modes are also available.
2. Choose strengths, improvements, or human corrections as the case category, or create and reuse a custom category with a stable identifier and editable name. Sources map existing strengths, improvements, risks, suggestions, custom analysis labels, and corrections.
3. Different filter fields intersect; values within one field form a union. Empty fields impose no restriction. Keywords search rationale, suggestions, and associated dialogue. Minimum confidence applies only to AI sources.
4. Enabled rules process only newly published successful analyses and newly saved corrections. Save a rule, select dates, preview historical matches, then start backfill. Runs show progress and safe failure reasons with retry. Retries preserve reviewed, edited, and rejected records.
5. Analysis tags offer collection and correction actions; the analysis overview supports manual dialogue selection. Corrections version category, rationale, and suggested reply while preserving the original AI judgment. Dialogue uses the confirmation version actually consumed by the analysis; changing roles or selection cannot rewrite the original text.
6. Knowledge details link to cases and review. Candidates support editing, publication, rejection, and bulk actions. Case details separate original dialogue, rationale, supplements, and suggested replies, with customer-only, sales-only, and chronological playback.

## Persistence and recovery

[Migration 037](../apps/api/migrations/037_analysis_case_collection.sql) adds rules, immutable correction versions, cases and versions, media, tasks, and collection runs. Transactional triggers enqueue successful analyses and corrections with frozen rule snapshots. A separate Worker uses PostgreSQL leases, SKIP LOCKED, and named LangGraph nodes. No Redis queue is introduced.

A case is authoritative editable content; one generated document provides its retrieval projection through existing ingestion, embeddings, and revision publication. An edit creates a new version while the previous active revision remains searchable until publication succeeds. Generic document editing, renaming, or replacement redirects authors to the case entry. Withdrawal or deletion stops retrieval immediately; generic document and knowledge-base deletion also delete associated cases and enqueue media cleanup. Existing historical citations retain evidence snapshots.

Evidence includes the complete span between linked turns and immediately preceding customer turns. Unknown roles remain unconfirmed; users may adjust selected turns and roles. Time ranges stay tied to the frozen confirmation text. Suggested replies never appear as original sales audio.

Official MP3 turns live under the existing `KNOWLEDGE_STORAGE_DIR/case-media`, using existing FFmpeg configuration. Source audio expiry does not remove these files. Retrieval and media status remain separate. Missing source files, FFmpeg failures, and playback failures preserve text; unavailable turns have no enabled playback controls. Restore the source or configuration and retry. Case deletion reclaims recorded media across versions, with up to three background cleanup attempts.

## Setup and checks

Apply migrations from the repository root before starting the updated API:

```sh
pnpm --filter @echowave/api migrate
```

037 depends on earlier ordered migrations, including the document lifecycle in 036. No environment variables are added. The knowledge directory must be writable and existing FFmpeg must run. Include `case-media` in knowledge-directory backups. If migration history differs from the actual schema, inspect and reconcile it before startup.

```sh
pnpm --filter @echowave/contracts test
pnpm --filter @echowave/api test
pnpm --filter @echowave/mobile test -- knowledge-collection collectionApi
pnpm check
```

An optional real PostgreSQL regression uses API `.env` configuration and requires schema creation privileges:

```sh
pnpm --filter @echowave/api build
pnpm --filter @echowave/api exec node test/knowledge/collection/verify-postgres.mjs
```

It applies all ordered migrations in an isolated schema, validates synthetic events, deduplication, review, projections, pgvector retrieval, versions, corrections, and deletion, then rolls back all DDL and data. It never commits business migrations. Ordinary tests do not require a live database.

## Next phase

Cases retain real customer turns, reference sales answers, rationale, confirmation versions, and independent audio mappings for future practice. Recording, simulated conversations, and model scoring are outside this release.

Rule folders are introduced by `038_collection_rule_folders.sql`. New source events freeze rule identity, version and configuration. Multiple folders may share one case and its independent retrieval document. Legacy automatic cases use Historical collection; unlinked manual cases use Manual collection. Organizing historical cases changes only membership metadata within the same library and source group, without parsing or vectorization. Directory search includes rule names and contained case titles.
