# EchoWave Future Roadmap

**English** | [简体中文](./ROADMAP.zh-CN.md)

This roadmap describes the problems the EchoWave open-source project intends to solve and the completion criteria for each stage. It is not a release-date commitment. Priorities may change with security risk, user feedback, contributor capacity, and upstream provider changes; linked issues and merged code remain authoritative.

## Roadmap principles

- Improve self-hosting security, installability, and recoverability before pursuing scale or feature count.
- Keep PostgreSQL as the sole source of business truth; caches and queues must not create a second authoritative store.
- Keep audio, transcript confirmations, and analysis results versioned, traceable, retryable, and free from silent overwrites.
- Evolve provider, model, and regional support through capability contracts rather than leaking one provider's details into clients.
- Preserve shared behavior across Android, iOS, and Web, and explicitly label platform capabilities that have not been verified.

## 1. Installability and onboarding

The goal is for non-developers to install the App, start their own Server, and receive actionable configuration diagnostics.

- Maintain reproducible signed Android APKs, GitHub Releases, release notes, and upgrade/rollback procedures; continue verifying the N-1 Server compatibility window.
- Provide screenshots, demo recordings, and first-run flows that contain no real business data.
- Improve self-checks for the Server, database, FFmpeg, providers, credentials, OSS, and mobile connectivity.
- Finish clearly marked in-progress operations such as re-transcription and targeted retry of failed jobs.
- Provide verified backup, restore, and version-upgrade procedures for Compose volumes.

Completion signal: a new user can follow only the README and self-hosting documentation to complete “install App → connect Server → upload audio → receive analysis” on a trusted LAN.

## 2. Production security foundation

The goal is to evolve from a fixed development tenant into a boundary suitable for real teams.

- Add real accounts, sessions, tenant membership, and minimum viable RBAC, including migration of fixed-tenant data.
- Provide HTTPS/reverse-proxy deployment references, trusted-proxy configuration, rate limits, and request/upload quotas.
- Improve audits and alerts for administrative actions, credential use, data export, and deletion.
- Define key rotation, encrypted backups, disaster recovery, security updates, and supported-version policies.
- Add dependency/container vulnerability scanning, secret detection, and a responsible disclosure process.

Completion signal: the project has an explicit threat model and multi-user isolation tests, and official documentation no longer relies on “trusted LAN only” as the sole security premise.

## 3. Scalable runtime

The goal is to support multiple processes and longer jobs without losing snapshots, idempotency, or versioned results.

- Split API, ingestion, ASR, post-analysis, business-analysis, and notification workers into independent runtime units.
- Add durable task coordination and cross-instance wakeups; if Redis is adopted, limit it to cache, coordination, or queue duties.
- Replace in-process SSE wakeups with a cross-instance event channel while preserving cursor and reconnect semantics.
- Make authoritative object storage the default scalable audio path, with explicit temporary-object and cleanup compensation behavior.
- Add structured logs, metrics, traces, backlog monitoring, and provider cost/rate-limit observability.

Completion signal: at least two API/Worker instances can safely process one tenant's jobs without duplicate publication or a shared local audio directory.

## 4. Broader knowledge and audio capabilities

The goal is to expand import formats, model choice, and analysis scenarios while preserving current trust boundaries.

- Add controlled data-source connectors and incremental synchronization without making third-party systems authoritative business storage.
- Support PDF, OCR, and legacy Office formats while retaining page-, cell-, or paragraph-level source locations.
- Add pluggable ASR, embedding, and text-model capabilities with regional, pricing, lifecycle, and output-quality validation.
- Improve hybrid retrieval, reranking, answer streaming, and large knowledge-base pagination.
- Evolve sales review into versioned analysis templates and domain vocabularies while preserving structured output contracts.

Completion signal: adding a provider, document format, or analysis template never requires bypassing shared contracts, audit, retry, or citation validation.

## 5. Platform coverage and privacy

The goal is to lower deployment and usage friction across devices and network environments.

- Complete native iOS build, notification, audio-playback, and release verification on macOS/Xcode.
- Add QR or mDNS LAN discovery while preserving address validation, HTTPS, and explicit user confirmation.
- Improve Web deployment, keyboard, and accessibility behavior, with clear browser media/storage limitations.
- Evaluate the cost and platform feasibility of on-device transcription, partially offline analysis, and end-to-end encryption.

Completion signal: every supported platform has explicit build, upgrade, compatibility, and regression evidence rather than code-only claims.

## Explicit non-commitments

- No fixed dates or ordering are promised for roadmap items.
- No official hosted cloud service, free third-party model quota, or long-term availability of any provider is promised.
- Public exposure of the current API is not recommended before authentication and the production security baseline exist.
- Offline support will not be pursued by duplicating PostgreSQL business data without a synchronization contract.

To advance an item, follow the [contribution guide](./CONTRIBUTING.md) and open an issue describing the user problem, scenario, boundaries, and verifiable completion criteria.
