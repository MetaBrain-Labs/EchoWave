# Automated End-to-End Audio Analysis

**English** | [简体中文](./audio-analysis-automation.zh-CN.md)

The Create page can place 1–20 new files or existing audio assets in one batch. A batch fixes one data source and one group. Upload and structural validation happen immediately; `scheduledFor` only controls when ASR, emotion, role, and business-analysis work becomes claimable.

## Runtime-mode boundaries

All three modes support “close the App after upload completes; the Server continues in the background.” The difference is not whether processing is asynchronous, but where the original audio is stored and how much can be recovered after a server failure, restart, or migration. App and background-task lifecycles are decoupled only after the audio upload completes and the server task is successfully created/submitted; killing the App while upload is still in progress does not mean the Server has taken over.

- Lightweight local = asynchronous processing + temporary local storage = lowest cost / lowest recovery capability. It supports immediate batches but rejects future schedules. A source blocked by an audio-dependent stage is retained for 24 hours; after expiry, the user must select a file with the same SHA-256 and byte count.
- Hybrid = asynchronous processing + persistent local storage + OSS staging = default / balanced cost and reliability. It supports immediate, batch, scheduled, and resumable execution but requires persistent `AUDIO_STORAGE_DIR` and currently a single API instance.
- Object storage = asynchronous processing + persistent OSS storage = cloud deployment / large scale / best recovery capability. It supports immediate, batch, scheduled, and resumable execution through presigned PUT uploads.

PostgreSQL `audio_analysis_batches` and `audio_analysis_tasks` are the only authoritative state. Workers use `FOR UPDATE SKIP LOCKED`, `LISTEN/NOTIFY`, and a 15-second compensation scan to advance `ASR → system_raw_snapshot → emotion and role → business analysis`. Permanent emotion or role failures become report limitations and yield `completed_with_warnings`; permanent ASR or business-analysis failures never publish a false success.

Each task records `created`, `reused`, `skipped`, or `unavailable` provenance for transcription, emotion, role, and business analysis. Pre-migration historical tasks have `unknown` provenance and must not be inferred. With `AI_EXECUTION_REPORT_ENABLED`, the first terminal transition also writes one atomic, redacted `audio-analysis-batch` Markdown manifest; reused results never fabricate model calls or cost records.

## Recovery and cancellation

Workers recover network failures, ordinary 429 responses, and 5xx responses through their existing backoff and checkpoints. Only explicit exhausted quota/balance, invalid credentials, or missing configuration produces `hard_blocked`. The first capability blocker pauses work that has not yet called that capability. Resume refreshes only incomplete-stage capability revisions and preserves completed results.

Cancellation completes tasks that have not started immediately. When an external call has already been submitted, the system sets `cancel_requested`, waits for that call to converge, and suppresses later stages.

## Push deployment

The App uses `expo-notifications`; the API uses `expo-server-sdk` and a PostgreSQL outbox. It sends only `HARD_BLOCKED`, `FAILED`, `COMPLETED`, and `PARTIAL_COMPLETED`. Notification data contains only `type`, `batchId`, and `taskId`; opening a notification reloads authoritative batch state.

Remote push requires a Development or Production Build containing the native notification module; Expo Go is insufficient. The server starts the delivery worker only when `PUSH_NOTIFICATIONS_ENABLED=true` is explicitly set in `apps/api/.env`, and advertises this through `/health.capabilities.remotePush`. The self-hosted template defaults to `false`. Only a successful `POST /api/push-devices` means registration completed.

EAS requires a `projectId`; deployments using Expo access-token security must also set `EXPO_PUSH_ACCESS_TOKEN`. Verify access to `exp.host`. The worker backs off network, 429, and 5xx failures, checks tickets and receipts, and disables tokens on `DeviceNotRegistered`. Diagnostics exclude tokens, credentials, and notification bodies. Android FCM v1 is the currently recorded and verified path; iOS still requires Apple Developer/APNs credentials and native verification on macOS.
