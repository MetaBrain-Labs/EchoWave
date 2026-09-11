# EchoWave Self-hosting and App Builds

**English** | [简体中文](./self-hosting.zh-CN.md)

EchoWave supports two open-source paths. After a stable tag is published, ordinary users download the matching signed Android APK and Server ZIP from [GitHub Releases](https://github.com/MetaBrain-Labs/EchoWave/releases). Maintainers and fork owners may clone source and build Development or Production clients. See [Server Deployment](./server-deployment.md) for Ubuntu, Windows Docker Desktop, HTTPS, backups, and uninstall; see [Releases](./releases.md) for checksums, upgrades, and rollback.

The current API uses a fixed development tenant and has no real authentication, RBAC, or rate limiting. Trusted localhost/LAN deployments may use HTTP. Every public or cloud Server requires an HTTPS reverse proxy, restricted 443 access, and no public 3001/5432; even then, this preview is not a public multi-user service.

Choose an audio mode before use: all three modes support closing the App after the upload completes and the server task is successfully created/submitted; the Server then continues in the background. Lightweight local uses temporary local storage for the lowest cost but lowest recovery capability; default hybrid uses persistent local storage plus OSS staging for balanced cost and reliability; object storage uses persistent OSS storage for cloud deployment, large scale, and best recovery. Killing the App before upload completes does not mean the Server has taken over. Changes affect new assets only. See [Audio Runtime Modes](./audio-runtime-modes.md).

## Docker self-hosted Server

Release users extract `EchoWave-server-vX.Y.Z.zip`, copy `api.env.example` to `api.env`, then run `docker compose pull && docker compose up -d`. The package pins a GHCR image digest and requires no source build. Root Compose source-build details are for clone/fork development; operating-system and public HTTPS details stay authoritative in [Server Deployment](./server-deployment.md).

### 1. Configuration

From the repository root:

```powershell
Copy-Item deploy/self-hosted/api.env.example deploy/self-hosted/api.env
```

```bash
cp deploy/self-hosted/api.env.example deploy/self-hosted/api.env
```

Replace at least `POSTGRES_PASSWORD`, canonical Base64 `CREDENTIAL_MASTER_KEY` for exactly 32 random bytes, and an independent `CONFIGURATION_ADMIN_TOKEN` of at least 32 random characters. Never commit `api.env`, Firebase service accounts, keystores, or credentials.

For a Local Credential Provider, create `deploy/self-hosted/.data/secrets/credentials.yaml`. Compose mounts it read-only at `/app/.data/secrets`, matching `LOCAL_CREDENTIALS_FILE=.data/secrets/credentials.yaml`. See [Configuration and Credentials](./configuration.md) for format and permissions.

### 2. Ports, startup, and health

The API listens on container port 3001 and maps host 3001 by default. To change only the host port in PowerShell, set `$env:ECHOWAVE_API_PORT = "3201"` before Compose.

```powershell
docker compose config
docker compose up -d --build
docker compose ps
Invoke-RestMethod http://localhost:3001/health
Invoke-RestMethod http://localhost:3001/api/hello
```

Adjust the URI when using another host port. Compose waits for PostgreSQL/pgvector, runs every numbered migration through one-shot `migrate`, then starts API. `/health` must identify `EchoWave`, `echowave-api`, `apiVersion=1`, and `status=ok`; `/api/hello` returns `{ ok: true, service: "echowave-api", message: "HelloWorld" }`.

PostgreSQL and audio live in `echowave_postgres` and `echowave_audio`. Temporary upload/transcription paths are container-temporary. Ordinary restarts/upgrades keep volumes; resolve exact targets and stop writes before backup, restore, or deletion.

### 3. LAN connection

Find the host LAN address with `ipconfig`, `ip addr`, or router administration. Prefer a DHCP reservation and allow `<API_PORT>` only on a trusted private network. A phone uses `http://<SERVER_LAN_IP>:<API_PORT>`, never host `localhost`. Test `/health` in the phone browser before **Test Connection** and **Save and Continue**.

Self-hosted defaults `PUSH_NOTIFICATIONS_ENABLED=false`, so `/health.capabilities.remotePush=false`; the App does not request notification permission or register a token and uses SSE/in-app batch state.

## Source development

Install Node.js 24 and pnpm 11.3.0:

```powershell
pnpm install --frozen-lockfile
Copy-Item apps/api/.env.example apps/api/.env
Copy-Item apps/mobile/.env.example apps/mobile/.env
pnpm --filter @echowave/api migrate
pnpm start
```

Alternatively run `pnpm dev:api` and `pnpm dev:mobile -- --lan` in separate terminals. For corrupt Metro cache, stop old Metro and run `pnpm dev:mobile -- --lan --clear`.

Development Build is the default native environment. TS/TSX uses Fast Refresh. Rebuild after Expo SDK, native dependency, permission, Firebase, notification, or other native configuration changes. Expo Go previews only compatible features and cannot verify Android remote push:

```powershell
pnpm --filter @echowave/mobile dev:go -- --lan
```

Metro Tunnel proxies only Expo/Metro, not the EchoWave API.

## Official Android Development Build

The official EAS project is already linked. Maintainers run EAS only from `apps/mobile` and do not rerun `eas init`. Keep ignored `google-services.json` at `apps/mobile/google-services.json` and upload it as a secret file for both environments:

```powershell
Set-Location apps/mobile
pnpm dlx eas-cli@latest env:set --environment development --name GOOGLE_SERVICES_JSON --value ./google-services.json --type file --visibility secret --scope project
pnpm dlx eas-cli@latest env:set --environment production --name GOOGLE_SERVICES_JSON --value ./google-services.json --type file --visibility secret --scope project
pnpm dlx eas-cli@latest env:list --environment development
pnpm dlx eas-cli@latest env:list --environment production
pnpm dlx eas-cli@latest credentials -p android
pnpm dlx eas-cli@latest build --platform android --profile development
```

The FCM v1 service account and `google-services.json` must belong to the same Firebase project or push can fail with `MismatchSenderId`. The service-account private key exists only in EAS Credentials.

## Android push acceptance

Set `PUSH_NOTIFICATIONS_ENABLED="true"` in the acceptance API `.env`, restart API, and verify `capabilities.remotePush=true` over the actual Server origin. Then:

1. Connect the App and grant Android notification permission.
2. Under **More → Service Status**, verify the push card says the device is registered; repair token/API/permission errors and retry registration.
3. Verify an active Android `push_devices` record; OS permission alone is not registration.
4. Verify the build token with Expo's push test tool.
5. Create an analysis batch, background the App, and inspect event, delivery, ticket, receipt, and system notification.
6. Open the notification and verify navigation to its batch.
7. Inspect structured API/outbox diagnostics for `InvalidCredentials`, `MismatchSenderId`, and `DeviceNotRegistered` without logging tokens.

A fully reused batch still writes one `audio-analysis-batch` diagnostic manifest when reporting is enabled; no new model-call report is expected. iOS requires separate Apple Developer/APNs setup and native verification on macOS/Xcode.

## Production APK and store build

```powershell
Set-Location apps/mobile
pnpm dlx eas-cli@latest build --platform android --profile production-apk
```

`production-apk` has no development menu or Metro connection and requires first-run Server selection. Development and Production profiles share one Android package; uninstall or clear data before acceptance because an overlay install may retain AsyncStorage.

Verify that a clean Production APK shows only the connection page, enters after a valid `/health`, avoids push permission/registration when remote push is false, and drops old SSE/page state after switching Server. Google Play uses `production` to produce an AAB, which cannot be directly installed like an APK. Stable tags automate signed APK, Server ZIP, manifest, and SHA-256 publication after all gates pass.

## Forks and independent distribution

Forks must replace Expo owner/projectId/slug, Android package, iOS bundle ID, Firebase application and `google-services.json`, FCM v1, signing, and Apple/APNs credentials. From `apps/mobile`, log into the fork owner's Expo account, run `eas init` or `eas build:configure`, and upload that project's own environments and credentials. Never reuse maintainer identity or secrets.

Official references: [EAS environment variables](https://docs.expo.dev/eas/environment-variables/manage/), [FCM v1 credentials](https://docs.expo.dev/push-notifications/fcm-credentials/), [push setup](https://docs.expo.dev/push-notifications/push-notifications-setup/), [APK/AAB](https://docs.expo.dev/build-reference/apk/), and [clearing Metro cache](https://docs.expo.dev/router/installation/#clear-bundler-cache).
