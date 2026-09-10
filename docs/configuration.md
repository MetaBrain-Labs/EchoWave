# Configuration and Credential Guide

**English** | [简体中文](./configuration.zh-CN.md)

EchoWave separates configuration into three boundaries: `apps/api/.env` holds startup configuration, PostgreSQL holds ordinary tenant configuration, and Credential Providers hold secrets. The mobile client separately stores the current Server origin. Use **More → AI Configuration** for AI settings and **More → Service Status** for the Server address.

## Current model and platform choice

EchoWave currently centers on Alibaba Cloud Model Studio and Qwen because one platform covers text generation, embeddings, ASR, and multimodal models while also offering OpenAI-compatible access to third-party models such as DeepSeek. A deployer can enable most model services and OSS under one Alibaba Cloud account, reducing account and billing fragmentation. This does not mean every capability uses the same credential.

- A DashScope connection uses a Model Studio API key for Qwen embedding, file transcription, and acoustic emotion.
- DeepSeek remains a separate EchoWave logical connection. It may use the official DeepSeek API or a Model Studio workspace's OpenAI-compatible Base URL and Model Studio API key.
- Alibaba Cloud OSS uses an AccessKey ID/AccessKey Secret, not a Model Studio API key. Store it as a separate credential type even under the same cloud account.

Regions, workspaces, endpoints, and model availability differ. When Model Studio hosts the DeepSeek connection, use the endpoint and model actually available in the target region; never copy another account's Workspace ID. See [What is Model Studio](https://help.aliyun.com/zh/model-studio/what-is-model-studio/) and [DeepSeek API on Model Studio](https://help.aliyun.com/zh/model-studio/deepseek-api).

Authoritative defaults come from `packages/contracts/src/settings.ts`:

| Capability                                               | Provider type     | Default model/backend                |
| -------------------------------------------------------- | ----------------- | ------------------------------------ |
| Knowledge embedding                                      | DashScope         | `qwen3.7-text-embedding`             |
| Knowledge answers                                        | DeepSeek          | `deepseek-v4-flash`                  |
| Audio transcription                                      | DashScope         | `qwen-audio-3.0-asr-flash-filetrans` |
| Acoustic emotion                                         | DashScope         | `qwen3.5-omni-flash`                 |
| Business role, speaker review, business analysis         | DeepSeek          | `deepseek-v4-flash`                  |
| Temporary audio staging and authoritative object storage | Alibaba Cloud OSS | `aliyun-oss`                         |

Editable model fields support future adapted releases; they do not imply arbitrary compatibility with prompts, structured output, timestamps, speakers, thinking modes, or recovery protocols. Only repository-adapted defaults are guaranteed today. More models and providers will be added incrementally.

| Runtime mode      | DashScope | DeepSeek                                                 | Alibaba Cloud OSS                                    |
| ----------------- | --------- | -------------------------------------------------------- | ---------------------------------------------------- |
| Lightweight local | Required  | Required when using answers, roles, or business analysis | Not required                                         |
| Hybrid            | Required  | Required when using answers, roles, or business analysis | `audio_staging` required                             |
| Object storage    | Required  | Required when using answers, roles, or business analysis | `audio_staging` and `audio_primary_storage` required |

See [Audio Runtime Modes](./audio-runtime-modes.md) and [Server Deployment](./server-deployment.md).

## Startup `.env`

Create local `apps/api/.env` from `apps/api/.env.example`. The API reads only that file and does not merge the launcher process environment. In addition to HTTP, PostgreSQL, Redis, directory, FFmpeg, worker, and diagnostic fields, configure these security-sensitive values explicitly:

- `CREDENTIAL_MASTER_KEY`: canonical Base64 for exactly 32 random bytes, used by AES-256-GCM.
- `CONFIGURATION_ADMIN_TOKEN`: an independent random management secret of at least 32 characters.
- `LOCAL_CREDENTIALS_FILE`: explicit path to the server-local YAML; there is no implicit default.
- `TRUSTED_PROXY_CIDRS`: comma-separated reverse-proxy IPv4/IPv6 CIDRs allowed to assert `X-Forwarded-Proto`; set an explicit empty value without a trusted proxy.
- `PUSH_NOTIFICATIONS_ENABLED`: explicitly `true` or `false`; self-hosted defaults to `false`.

Provider URLs, buckets, models, thinking modes, DashScope notification mode, callback URL, and capability bindings are tenant configuration rather than startup environment. Set optional `EXPO_PUSH_ACCESS_TOKEN` only when Expo access-token security is enabled. It is a Server secret and must never use an `EXPO_PUBLIC_` prefix.

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

During upgrade, legacy `DASHSCOPE_*`, `DEEPSEEK_*`, and `ALIYUN_OSS_*` variables may temporarily remain. The page exposes only detected variable names and completeness, not values. **Import legacy Server `.env`** reads secrets internally, encrypts them into PostgreSQL, never overwrites current database configuration, and is idempotent per tenant.

Remote HTTP may trigger this import because its request body carries no secret. A successful import makes the database authoritative and disables legacy fallback for the tenant. Remove old provider variables, restart, and verify capabilities afterward. Startup-level fields remain. Alternatively, create `credentials.yaml` and configure Local aliases without importing old secrets.
