# Configuration and Credential Guide

**English** | [简体中文](./configuration.zh-CN.md)

EchoWave separates configuration into three boundaries: `apps/api/.env` holds startup configuration, PostgreSQL holds ordinary tenant configuration, and Credential Providers hold secrets. The mobile client separately stores the current Server origin. Verify the administrator token once under **More → Service configuration**; that page's tenant ASR default context and its entry cards for AI configuration and runtime mode share the verification. While unverified, AI configuration and runtime mode show only a verification prompt instead of loading content. The Server address and push registration live under **More → Service Status**, and device-level preferences such as language and the default analysis workflow live under **More → General settings**.

## Current model and platform choice

EchoWave currently centers on Alibaba Cloud Model Studio and Qwen because one platform covers text generation, embeddings, ASR, and multimodal models while also offering OpenAI-compatible access to third-party models such as DeepSeek. A deployer can enable most model services and OSS under one Alibaba Cloud account, reducing account and billing fragmentation. This does not mean every capability uses the same credential.

- A DashScope connection uses a Model Studio API key and now carries every capability by default: Qwen embedding, file transcription, acoustic emotion, and text generation (knowledge answers, business role, speaker review, business analysis).
- DeepSeek is an optional cost fallback. The same model costs less per cache hit on the official DeepSeek API than on Model Studio, so cost-sensitive deployments can rebind text capabilities to a DeepSeek connection. It may use the official DeepSeek API or a Model Studio workspace's OpenAI-compatible Base URL and Model Studio API key.
- Alibaba Cloud OSS uses an AccessKey ID/AccessKey Secret, not a Model Studio API key. Store it as a separate credential type even under the same cloud account.

Regions, workspaces, endpoints, and model availability differ. When Model Studio hosts the DeepSeek connection, use the endpoint and model actually available in the target region; never copy another account's Workspace ID. See [What is Model Studio](https://help.aliyun.com/zh/model-studio/what-is-model-studio/) and [DeepSeek API on Model Studio](https://help.aliyun.com/zh/model-studio/deepseek-api).

Authoritative defaults come from `packages/contracts/src/settings.ts`:

| Capability                                               | Provider type             | Default model/backend                |
| -------------------------------------------------------- | ------------------------- | ------------------------------------ |
| Knowledge embedding                                      | DashScope                 | `qwen3.7-text-embedding`             |
| Knowledge answers                                        | DashScope                 | `qwen3.5-omni-flash`                 |
| Audio transcription                                      | DashScope                 | `qwen-audio-3.0-asr-flash-filetrans` |
| Acoustic emotion                                         | DashScope                 | `qwen3.5-omni-flash`                 |
| Business role, speaker review, business analysis         | DashScope                 | `qwen3.5-omni-flash`                 |
| Temporary audio staging and authoritative object storage | Alibaba Cloud OSS (fixed) | `aliyun-oss`                         |

Every capability except the two OSS backends can search and change its model in AI configuration. Candidates come from the official Model Studio model list endpoint `GET /api/v1/models` and are filtered by capability responsibility:

- Text-generation capabilities only list models that support text generation (`TG`);
- Acoustic emotion additionally requires audio input, so pure text models and ASR-only models never appear;
- Knowledge embedding lists only text-vector (`TR`) models, and audio transcription only speech-recognition (`ASR`) models.

The first row of the picker is the capability default, labelled **verified**, but only when the selected connection can actually serve it: a DeepSeek connection only ever lists its own models, never the Qwen default, including when the list request fails. Only models this repository has adapted and verified can pass the check performed when a binding is saved; other catalogue entries stay searchable but are refused with a "not adapted yet" message:

- Embedding: vector dimensions are fixed at 1024, so a model with different output dimensions is refused outright (the `pgvector` column type and retrieval contract both hard-code it). After switching to another verified embedding model, existing documents only return to retrieval once they are re-ingested, because retrieval filters on `embedding_model`.
- Audio transcription: the runtime requires whole-file transcription, diarization, and word timestamps. Only `qwen-audio-3.0-asr-flash-filetrans` declares that adaptation metadata today, so it is the only bindable transcription model.

One model appearing in several capability catalogues is expected: `qwen3.5-omni-flash` supports both text generation and audio input, so it is the default for knowledge answers, business role, speaker review, and business analysis as well as for acoustic emotion. The pinned row states that the model is verified **for the current capability**, so it never reads as belonging to a single capability. To give knowledge answers a pure text model such as `qwen3-max`, register and validate it in `CAPABILITY_MODEL_REQUIREMENTS.knowledge_chat.verifiedModelIds` first.

After changing a model you must confirm it actually provides what the capability needs; the server only checks the capability catalogue and hard constraints such as dimensions. Prices, context windows, and declared vector dimensions in the model list response are selection hints only; they never drive billing and are not written to business tables. See [List models](https://help.aliyun.com/zh/model-studio/list-models) for the endpoint contract.

Reading the list degrades in three steps: first a capability-filtered request, then a pagination-only request if the filters are rejected, then a single request without pagination; whichever succeeds is filtered locally by capability responsibility. Responses that omit capability or modality metadata never empty the catalogue, and unadapted models are still refused when a binding is saved. When reading fails, the picker keeps the verified default model (it does not depend on the list endpoint) and shows a coarse reason (for example "the provider returned 401" or "network or timeout") so credentials, region, and connectivity problems can be told apart, without exposing the API key or the provider response body. Switching the provider connection refreshes the model field immediately: with the catalogue already loaded it moves to that connection's default or first candidate, and without a loaded catalogue it clears and asks for an explicit choice, so a model name from the previous connection is never carried over.

Editable model fields support future adapted releases; they do not imply arbitrary compatibility with prompts, structured output, timestamps, speakers, thinking modes, or recovery protocols.

## Rerank disclosure

When the tenant reranking switch is on and reranking is configured, knowledge answers, the read-only history panel, business-analysis reports, and the execution trace all state explicitly that reranking ran and what it achieved: the model name, how many candidates were reranked, how many passages were selected, how many of them were promoted by reranking, and the duration. Nothing about reranking appears while the switch is off, and a degraded run names its reason and states that the answer used vector search order.

"Promoted by reranking" is an effect proxy rather than a quality score: it counts the selected passages that vector order alone would not have selected. When neither the set nor the order changed, the copy says the result matched vector order. The disclosure carries only reproducible counts and statuses — never passage text, relevance scores, or credentials.

## Model Studio workspace-dedicated domains

New and updated DashScope connections store only a Workspace ID and region. That value is the part before the first dot of the **API Host** shown in the console workspace list or API key dialog, never a full host name: early workspaces use `llm-…` and newer ones use `ws-…`, and both are valid. The region must match the region inside that host. The Server derives the native endpoint `https://{workspaceId}.{region}.maas.aliyuncs.com/api/v1` and OpenAI-compatible endpoint `https://{workspaceId}.{region}.maas.aliyuncs.com/compatible-mode/v1`. Embedding, reranking, model discovery, file transcription, and temporary upload policies use the native endpoint; Qwen chat capabilities use the compatible endpoint. The default region is `cn-beijing`; `ap-southeast-1`, `ap-northeast-1`, `eu-central-1`, `cn-hongkong`, and `us-east-1` are also supported. The API key must belong to the same region and workspace.

Existing database configs containing `baseUrl`, `compatibleBaseUrl`, and `rerankBaseUrl` remain read-only-compatible but cannot be saved through the public write API. More shows a migration card for these connections. After an administrator supplies one Workspace ID and region, the Server verifies every connection's own credential against the target `/api/v1/models`; only if all checks pass does one transaction create provider revisions, revise current capability bindings, and create a missing `knowledge_rerank` binding. Historical revisions and frozen jobs are unchanged.

See [Model Studio regions and endpoints](https://help.aliyun.com/en/model-studio/regions/) for the authoritative region and deployment-scope matrix.

| Runtime mode      | DashScope | DeepSeek (optional text-capability swap) | Alibaba Cloud OSS                                    |
| ----------------- | --------- | ---------------------------------------- | ---------------------------------------------------- |
| Lightweight local | Required  | Required only after rebinding text tasks | Not required                                         |
| Hybrid            | Required  | Required only after rebinding text tasks | `audio_staging` required                             |
| Object storage    | Required  | Required only after rebinding text tasks | `audio_staging` and `audio_primary_storage` required |

See [Audio Runtime Modes](./audio-runtime-modes.md) and [Server Deployment](./server-deployment.md).

## Startup `.env`

Create local `apps/api/.env` from `apps/api/.env.example`. The API reads only that file and does not merge the launcher process environment. In addition to HTTP, PostgreSQL, Redis, directory, FFmpeg, worker, and diagnostic fields, configure these security-sensitive values explicitly:

- `CREDENTIAL_MASTER_KEY`: canonical Base64 for exactly 32 random bytes, used by AES-256-GCM.
- `CONFIGURATION_ADMIN_TOKEN`: an independent random management secret of at least 32 characters.
- `LOCAL_CREDENTIALS_FILE`: explicit path to the server-local YAML; there is no implicit default.
- `TRUSTED_PROXY_CIDRS`: comma-separated reverse-proxy IPv4/IPv6 CIDRs allowed to assert `X-Forwarded-Proto`; set an explicit empty value without a trusted proxy.
- `PUSH_NOTIFICATIONS_ENABLED`: explicitly `true` or `false`; self-hosted defaults to `false`.

Provider URLs, buckets, models, thinking modes, DashScope notification mode, callback URL, and capability bindings are tenant configuration rather than startup environment. During legacy environment import only, `DASHSCOPE_WORKSPACE_ID` and optional `DASHSCOPE_REGION` replace the three old URL variables; structured workspace configuration wins and defaults to `cn-beijing`. Set optional `EXPO_PUSH_ACCESS_TOKEN` only when Expo access-token security is enabled. It is a Server secret and must never use an `EXPO_PUBLIC_` prefix.

## Local Credential Provider

Typical `LOCAL_CREDENTIALS_FILE` locations are:

- Linux/macOS: `~/.echowave/credentials.yaml`
- Windows: `C:\Users\<user>\.echowave\credentials.yaml`
- Docker: `/app/.data/secrets/credentials.yaml`

The format is fixed:

```yaml
version: 1

credentials:
  dashscope-main:
    type: dashscope
    apiKey: sk-example
    eventBridgeCallbackToken: callback-example

  deepseek-main:
    type: deepseek
    apiKey: sk-example

  aliyun-oss-main:
    type: aliyun_oss
    accessKeyId: example-id
    accessKeySecret: example-secret
```

The parser rejects unknown fields, duplicate keys, YAML anchors/aliases, custom tags, and files larger than 64 KiB. It never performs environment interpolation. On POSIX systems, make the file readable only by the service account:

```sh
chmod 600 ~/.echowave/credentials.yaml
```

On Windows, use **Properties → Security** to grant read access only to the current user or API service account. In Docker, mount the host directory read-only and set host permissions to `0600`:

```yaml
services:
  api:
    volumes:
      - ./deploy/self-hosted/.data/secrets:/app/.data/secrets:ro
```

The provider reloads the complete file only after a version change and atomically replaces its in-memory snapshot after successful validation. An invalid update preserves the process's last valid snapshot for already-created work but blocks new connections or bindings. Local aliases are part of task versions: add a new alias, switch connection references, wait for old work to finish, then remove the old alias. Do not rotate secrets in place.

## Mobile Server address

Expo CLI loads `apps/mobile/.env`. Client-visible fields require the `EXPO_PUBLIC_` prefix and are public bundle content. `EXPO_PUBLIC_API_URL` is only the development default for a Development Build or Expo Go without a saved address; it must contain no credential or token.

The App validates `GET /health`, normalizes the Server root, and stores it in AsyncStorage. A saved address wins. REST, upload, SSE, media, and push registration read the same runtime origin at request time. Switching Server stops old connections, clears page state, and remounts business navigation.

`production-apk` and `production` set `EXPO_PUBLIC_REQUIRE_SERVER_SELECTION=true`, so Production Builds ignore accidental build-time API defaults and require first-run selection. EAS uses a remote app-version source. Only `production-apk` auto-increments Android `versionCode`; the user-visible version must match the stable tag and Server package in source.

An address must be an HTTP/HTTPS origin without credentials, query, fragment, or business path. HTTP accepts only localhost, private IPv4, loopback/link-local IPv6, shared address space, and `.local`; public hosts require HTTPS. Health must satisfy the shared schema:

```json
{
  "name": "EchoWave",
  "service": "echowave-api",
  "version": "0.1.0",
  "apiVersion": 1,
  "status": "ok",
  "capabilities": {
    "remotePush": false
  }
}
```

When `remotePush=false`, the App does not request notification permission or register a device. When true, only native builds continue to Expo Push registration; Expo Go degrades safely.

## Transport security

Network submission of a Database Credential is allowed only when the API socket is directly HTTPS, both real peer and Host are loopback/localhost, or the real peer matches `TRUSTED_PROXY_CIDRS` and the trusted proxy asserts `X-Forwarded-Proto: https`. Forwarded headers from untrusted peers are ignored.

Remote HTTP shows a persistent warning, disables secret entry/paste/autofill/submission, and the API rejects nested, empty, or batched secret fields with `403 INSECURE_CREDENTIAL_TRANSPORT`. Names, HTTPS Base URLs, models, thinking modes, notifications, capability bindings, and Local aliases remain editable.

Ordinary administration uses `Authorization: Bearer <CONFIGURATION_ADMIN_TOKEN>`. The App stores the token only in current-page memory. Remote HTTP provides no confidentiality for it; production deployment requires HTTPS.

Editable provider Base URLs must be public HTTPS endpoints. The Server rejects localhost, private, link-local, reserved, cloud-metadata, and DNS-resolved private addresses.

## Database Credentials and task revisions

Database Credentials use a random 12-byte IV, AES-256-GCM tag, and AAD bound to tenant, credential, version, and provider type. The API exposes only configured status and masked final characters, never plaintext.

Changing a secret creates an immutable Credential version. Changing a connection creates a Provider revision and publishes new binding revisions for affected capabilities. New requests use the current revision; queued, running, recovering, or callback-waiting tasks retain their creation-time revision. Snapshots store only a Database version ID or Local alias/type, never a secret.

## Importing legacy `.env` settings

During upgrade, legacy `DASHSCOPE_*`, `DEEPSEEK_*`, and `ALIYUN_OSS_*` variables may temporarily remain. New environments should set `DASHSCOPE_WORKSPACE_ID` and optional `DASHSCOPE_REGION`; when present, import derives the dedicated native and compatible endpoints from them. Existing deployments may still read `DASHSCOPE_BASE_URL`, `DASHSCOPE_COMPATIBLE_BASE_URL`, and `DASHSCOPE_RERANK_BASE_URL`, but the standalone rerank URL no longer participates in runtime routing. The page exposes only detected variable names and completeness, not values. **Import legacy Server `.env`** reads secrets internally, encrypts them into PostgreSQL, never overwrites current database configuration, and is idempotent per tenant.

Remote HTTP may trigger this import because its request body carries no secret. A successful import makes the database authoritative and disables legacy fallback for the tenant. Remove old provider variables, restart, and verify capabilities afterward. Startup-level fields remain. Alternatively, create `credentials.yaml` and configure Local aliases without importing old secrets.

## Persistent knowledge originals

`KNOWLEDGE_STORAGE_DIR` is required in the API `.env`; the templates use `.data/knowledge`. Paths resolve relative to the API directory. Compose persists it in `echowave_knowledge`. Back up this volume together with PostgreSQL.

Knowledge originals are immutable per revision. Successful ingestion retains them; deletion and version retirement enqueue resumable cleanup. `UPLOAD_TEMP_DIR` remains for legacy staged inputs. Age alone never authorizes removing a database-referenced file.
