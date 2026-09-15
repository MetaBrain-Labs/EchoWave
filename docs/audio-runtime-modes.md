# Audio Runtime Modes

**English** | [简体中文](./audio-runtime-modes.zh-CN.md)

EchoWave provides three tenant-level audio runtime modes. A mode change affects only `AudioAsset` records created afterward. Each asset freezes its mode, storage backend, storage-binding revision, and cleanup deadline; existing assets are never implicitly migrated or deleted.

## Deployment choice

| Mode                                  | Source audio location                                         | OSS requirement             | Recovery and reruns                                                                             | Best fit                                                |
| ------------------------------------- | ------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Lightweight local `lightweight_local` | API temporary directory; removed after success or expiry      | None                        | Re-transcription after cleanup requires reselecting a file with the same SHA-256 and byte count | Trials, low storage cost, no long-term source retention |
| Hybrid `hybrid`                       | API `AUDIO_STORAGE_DIR`; `echowave_audio` volume under Docker | `audio_staging` only        | Playback and audio-dependent reruns remain available while the source exists                    | Default; long-term local source retention               |
| Object storage `object_storage`       | `audio_primary_storage` OSS                                   | Primary storage and staging | Recoverable from the OSS original during retention; historical results survive expiry           | Larger audio collections and managed object lifecycles  |

All three modes support asynchronous processing: users can close the App and let the Server continue in the background only after the upload completes and the server task is successfully created/submitted. The difference is not whether processing is asynchronous, but where the original audio is stored and how much can be recovered after a server failure, restart, or migration.

Their cost and recovery positioning is:

- Lightweight local = asynchronous processing + temporary local storage = lowest cost / lowest recovery capability.
- Hybrid = asynchronous processing + persistent local storage + OSS staging = default / balanced cost and reliability.
- Object storage = asynchronous processing + persistent OSS storage = cloud deployment / large scale / best recovery capability.

The only important boundary is that killing the App while audio is still uploading does not mean the Server has taken over in any mode. App and background-task lifecycles are decoupled only after the upload completes and the server task is successfully created/submitted.

All modes require PostgreSQL, FFmpeg/VAD, and DashScope audio capabilities. Role, knowledge-answer, and business-analysis stages also require a DeepSeek logical connection. Hybrid and object-storage modes require their OSS bindings; lightweight local works without OSS.

When unsure, start with lightweight local for a functional trial, switch future assets to hybrid when playback or reruns matter, and choose object storage only with an established OSS lifecycle and backup policy. Mode switching is not a storage-migration tool. See [Server Deployment](./server-deployment.md).

## Modes

### Hybrid `hybrid`

This is the default and preserves the original behavior. Source audio remains in API `AUDIO_STORAGE_DIR`; FFmpeg/VAD output is staged briefly through `audio_staging` OSS for DashScope. Acoustic emotion is started separately after transcript confirmation.

### Object storage `object_storage`

The mobile client uploads source audio directly to `audio_primary_storage` OSS using a presigned PUT. The API streams data into controlled temporary paths only for validation, ASR preprocessing, and acoustic windows, then removes those copies. Tenant retention policy controls the authoritative original. Historical transcripts and emotion results remain after expiry, but acoustic emotion cannot be rerun. `/api/audio-files/:id/content` is the stable Range-capable proxy endpoint.

### Lightweight local `lightweight_local`

The mobile client streams source audio into the API temporary audio directory. Initial upload and every manual re-transcription offer an “also run acoustic emotion analysis” switch, enabled by default:

- Enabled: `VAD → ASR → transcript publication → acoustic emotion → cleanup`.
- Disabled: `VAD → ASR → transcript publication → cleanup`; that ASR revision has no emotion request yet; after confirmation, a matching original can be remounted for a later run.

Acoustic analysis cuts windows from the current Raw Transcript timestamps, so it runs sequentially and never in parallel with the ASR provider call. After cleanup, the player reports that source audio was not retained. A new run requires reselecting the original file; the API verifies its saved SHA-256 and size.

## Authority and recovery

PostgreSQL stores transcripts, VAD manifests, ASR runs, provider task IDs, checkpoints, confirmation versions, emotion/role results, and business analyses. Object storage and local directories hold only audio binaries and short-lived intermediates; they do not duplicate transcript JSON or create a `finish` audio file.

After a server restart, PostgreSQL batch state, task state, and checkpoints continue to drive background work; recovery of audio-dependent stages depends on the original audio still being available. If lightweight-local temporary storage is lost or expires, published results remain but audio-dependent stages require remounting the original file. Hybrid recovery across restarts or host migration requires preserving and remounting `AUDIO_STORAGE_DIR`. Object storage is best for cross-host migration and large-scale recovery when PostgreSQL, OSS bindings, and retained originals remain accessible.

ASR revision checkpoints are:

`source_validated → preprocessing_ready → provider_staged → provider_submitted → provider_terminal → transcript_published → acoustic_emotion_completed → cleanup_completed`

Provider task ID and terminal state are persisted before progression, preventing duplicate submission after restart. A published transcript resumes only emotion or cleanup. Lightweight-local source files for terminal failures remain for at most 24 hours after the last failure; startup and 15-minute compensation jobs remove expired files.

## Phone recording, archive intent, and originals

Android/iOS share an application-level recorder through Create → Phone recording and the data-source recording entry. Capture supports pause, resume, stop, and playback using high-quality M4A/AAC. Web retains import and directs recording users to the phone app. Originals remain in the phone document directory until manually deleted, with size, export, and deletion controls independent of server assets.

| Mode              | Save without analysis                                                        | Analysis and recovery                                                                                                                     |
| ----------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Lightweight local | Phone only, no upload or server count; explicitly visible only on this phone | Upload on analysis; automatically remount a retained phone original after cleanup; imported files require matching SHA-256 and byte count |
| Hybrid            | Publish an asset in API persistent storage without analysis                  | Reuse that asset; retain the phone original                                                                                               |
| Object storage    | Presigned PUT to OSS and publish an asset without analysis                   | Reuse during retention; expiry preserves results and prohibits acoustic reruns                                                            |

Versioned phone metadata binds server URL, data source, session, batch, and frozen submission settings before network operations. Idempotent retries reuse their identities and uploaded rows merge with server assets. New sessions use their creation-time mode; existing assets keep their frozen mode. A changed server or archived target prohibits automatic upload and requires an explicit valid target. Remote operations already started remain bound to their original server.

Lightweight acoustic reruns require published, confirmed transcription and use the corresponding ASR revision's original word timestamps. DashScope temporary upload staging needs no additional OSS configuration. Remounting never silently retranscribes. Queued/running work prevents cleanup; success cleans the server copy, while failure uses the existing deadline.

Rebuild native Development/Production Builds after permission changes. Android uses a recording foreground service and ongoing notification; iOS enables background audio and localized microphone permission text. Interruptions preserve readable content without automatically resuming capture. Force termination does not guarantee ongoing capture; startup recovers readable drafts. Uploads over 200 MB or 12 hours are rejected, but originals remain exportable. Lock-screen, background, and notification-stop behavior require device verification; native iOS verification requires macOS/Xcode.

Upload creation accepts `postUploadAction: transcribe | store_only`, defaulting to `transcribe` for older clients. Lightweight server archive intent is rejected. Upload and batch creation accept optional `idempotencyKey`; conflicting parameters are rejected. Apply migration `039_recording_upload_intent.sql` before deployment.

## Configuration and API

More contains **Service Status / AI Configuration / Runtime Mode**. Anyone may read the mode; updates require `CONFIGURATION_ADMIN_TOKEN`. Object-storage activation requires `audio_primary_storage`, `audio_staging`, DashScope ASR, FFmpeg, and VAD. Lightweight activation requires DashScope ASR/acoustic emotion, FFmpeg, and VAD.

Main endpoints:

- `GET /api/audio-runtime`
- `PUT /api/settings/audio-runtime`
- `POST /api/data-sources/:id/audio-upload-sessions`
- `PUT /api/audio-upload-sessions/:id/content`
- `POST /api/audio-upload-sessions/:id/complete`
- `GET /api/audio-files/:id/transcriptions`
- `PUT /api/audio-files/:id/transcript-selection`
- `PUT /api/audio-files/:id/source-remount`

Selecting an older ASR run manually pins that selection; a later successful run does not override it. Returning to `auto` selects the latest successful revision.
