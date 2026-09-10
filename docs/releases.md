# GitHub Release Guide

**English** | [简体中文](./releases.zh-CN.md)

This guide covers downloading and verifying the EchoWave Android App and Server from GitHub Releases, first installation, upgrades, rollback, and maintainer publishing.

Stable versions are distributed only through a `vMAJOR.MINOR.PATCH` tag and its matching GitHub Release. GitHub-generated source archives are not Server installation bundles.

> EchoWave is a fixed-development-tenant preview without real authentication, RBAC, or rate limiting. HTTP is allowed on localhost and trusted LANs. Every public/cloud App Server requires HTTPS, a reverse proxy, narrowly scoped access, and no public 3001/5432. These controls still do not make it a public multi-user service.

## 1. Reading paths

- Android App only: sections 2, 3, and 5.
- Server deployment or upgrade: sections 2, 3, 4, 6, and 7.
- Repository release maintenance: sections 8 and 9.

See [Server Deployment](./server-deployment.md) for Ubuntu source, Windows Docker Desktop, runtime modes, HTTPS, stop, and uninstall.

## 2. Select and download a version

Open [EchoWave Releases](https://github.com/MetaBrain-Labs/EchoWave/releases). Use the latest stable version for a first installation; historical releases exist for rollback and reproduction.

| Asset                          | Purpose                                                                 |
| ------------------------------ | ----------------------------------------------------------------------- |
| `EchoWave-android-vX.Y.Z.apk`  | Android installer                                                       |
| `EchoWave-server-vX.Y.Z.zip`   | Docker Compose Server bundle pinned to an image digest                  |
| `EchoWave-release-vX.Y.Z.json` | Machine-readable commit, image, platform, migration, and rollback facts |
| `SHA256SUMS-vX.Y.Z.txt`        | SHA-256 for APK, Server ZIP, and manifest                               |

Use App and Server from the same Release when possible. `X.Y.Z` is a placeholder; replace it with the exact version.

## 3. Verify downloads

Delete and redownload any asset whose checksum fails.

```bash
# Linux, all downloaded assets
sha256sum --check SHA256SUMS-vX.Y.Z.txt

# macOS
shasum -a 256 --check SHA256SUMS-vX.Y.Z.txt

# Linux, Server ZIP only
grep 'EchoWave-server-vX.Y.Z.zip' SHA256SUMS-vX.Y.Z.txt | sha256sum --check -
```

For Server ZIP on PowerShell:

```powershell
$version = "X.Y.Z"
$file = "EchoWave-server-v$version.zip"
$line = (Select-String -Path "SHA256SUMS-v$version.txt" -Pattern ([regex]::Escape($file))).Line
$expected = $line.Split(' ', [System.StringSplitOptions]::RemoveEmptyEntries)[0]
$actual = (Get-FileHash $file -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $expected) { throw "Checksum mismatch: $file" }
Write-Host "Checksum verified: $file"
```

Use `EchoWave-android-vX.Y.Z.apk` for APK verification.

## 4. First Server deployment

### 4.1 Requirements

- Linux, macOS, or Windows Docker Desktop using Linux containers.
- Docker Engine/Desktop with Compose v2.
- Access to `ghcr.io`.
- For local deployment, the phone and Server share a trusted LAN and port 3001 is LAN-scoped.
- For cloud deployment, HTTPS and minimum security-group rules are ready; ports 3001 and 5432 are private.

```bash
docker version
docker compose version
```

### 4.2 Extract and configure

Use a stable installation directory so upgrades retain `api.env` and `.data/secrets`.

```bash
mkdir -p echowave
unzip EchoWave-server-vX.Y.Z.zip -d echowave
cd echowave
cp api.env.example api.env
mkdir -p .data/secrets
```

```powershell
Expand-Archive .\EchoWave-server-vX.Y.Z.zip -DestinationPath .\echowave
Set-Location .\echowave
Copy-Item .\api.env.example .\api.env
New-Item -ItemType Directory -Force .\.data\secrets | Out-Null
```

Replace `POSTGRES_PASSWORD`, canonical Base64 `CREDENTIAL_MASTER_KEY` for exactly 32 random bytes, and an independent `CONFIGURATION_ADMIN_TOKEN` of at least 32 characters. Never commit `api.env` or `.data/secrets/credentials.yaml`.

### 4.3 Start and accept

```bash
docker compose config
docker compose pull
docker compose up -d
docker compose ps
curl http://localhost:3001/health
curl http://localhost:3001/api/hello
```

`/health.status` must be `ok` and its version must match the Release. `/api/hello.message` must be `HelloWorld`. Compose uses immutable digest images for both `api` and `migrate`, no `build:` and no `latest`. Do not run `docker compose down --volumes` during ordinary operations.

## 5. Install the Android App

1. Download and verify the APK on Android.
2. Temporarily allow that download source to install unknown apps if Android requests it.
3. Install and open EchoWave.
4. Enter the Server's trusted LAN origin, such as `http://<SERVER_LAN_IP>:3001`, or its public HTTPS origin.
5. Complete the connection test before entering the App.

A physical phone cannot use the computer's `localhost` or `127.0.0.1`. LAN access requires a host firewall rule scoped to the trusted network.

### App rollback

Android cannot normally install a lower `versionCode` over a newer one. Record the Server address, uninstall EchoWave, verify/install the historical APK, then enter the Server again. Uninstalling the App clears local preferences but never Server PostgreSQL, audio, or analysis data.

## 6. Upgrade the Server

### 6.1 Required backup

Retain the current `api.env`, `CREDENTIAL_MASTER_KEY`, local secrets, current Server ZIP, and a non-empty custom-format database backup:

```bash
mkdir -p backups
docker compose exec -T postgres sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump --format=custom --no-owner --no-acl -U "$POSTGRES_USER" "$POSTGRES_DB" --file=/tmp/echowave-backup.dump'
docker compose cp postgres:/tmp/echowave-backup.dump backups/echowave-before-vX.Y.Z.dump
docker compose exec -T postgres rm -f /tmp/echowave-backup.dump
test -s backups/echowave-before-vX.Y.Z.dump
```

PowerShell verifies `(Get-Item .\backups\echowave-before-vX.Y.Z.dump).Length -gt 0`. Protect backups as sensitive data. Without the original Master Key, restored Database Credentials cannot be decrypted.

### 6.2 Replace the version

1. Verify the new ZIP, manifest, and checksum file.
2. Verify the database backup exists and is non-empty.
3. Preserve current `compose.yaml` and bundled README for rollback.
4. Extract new release-owned files into the installation directory.
5. Never overwrite live `api.env`, `.data/secrets`, or `backups`.
6. Run:

```bash
docker compose config
docker compose pull
docker compose up -d
docker compose ps
curl http://localhost:3001/health
curl http://localhost:3001/api/hello
```

API starts only after `migrate` succeeds. On failure inspect `docker compose ps -a`, `docker compose logs migrate`, and `docker compose logs api`.

After startup, create DashScope and DeepSeek connections under **More → AI Configuration** and configure OSS according to runtime mode: none for lightweight local, `audio_staging` for hybrid, and both `audio_staging`/`audio_primary_storage` for object storage. Save the mode under **More → Runtime Mode**. See [Configuration and Credentials](./configuration.md).

## 7. Roll back the Server

Read `database.minimumDirectRollbackVersion` from the current `EchoWave-release-vX.Y.Z.json`. A target at or above that version may directly use the database; an earlier target requires restoring the pre-upgrade backup.

### 7.1 Direct rollback inside the window

1. Verify the target historical Server ZIP.
2. Preserve `api.env`, `.data/secrets`, PostgreSQL volume, and audio volume.
3. Run `docker compose stop api`.
4. Replace release-owned files with the target ZIP.
5. Run:

   ```bash
   docker compose pull
   docker compose up -d
   docker compose ps
   curl http://localhost:3001/health
   curl http://localhost:3001/api/hello
   ```

Verify the target health version and App group/knowledge behavior.

### 7.2 Restore outside the window

Restoration overwrites current database objects and discards changes after the backup. Verify the exact instance and path first:

```bash
docker compose stop api
docker compose cp backups/echowave-before-vX.Y.Z.dump postgres:/tmp/echowave-restore.dump
docker compose exec -T postgres sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_restore --exit-on-error --clean --if-exists --no-owner --no-acl -U "$POSTGRES_USER" -d "$POSTGRES_DB" /tmp/echowave-restore.dump'
docker compose exec -T postgres rm -f /tmp/echowave-restore.dump
docker compose pull
docker compose up -d
docker compose ps
```

The audio volume is not rolled back and may contain files unreferenced by the restored database. EchoWave provides no generic down migration.

## 8. One-time maintainer setup

Repository administrators must:

1. Configure `EXPO_TOKEN` in the GitHub `release` Environment or Actions Secrets.
2. Configure Production `GOOGLE_SERVICES_JSON` in EAS and establish Android keystore/FCM credentials; signing private keys never enter the repository or GitHub Secrets.
3. Allow Actions to write required Repository contents and Packages only.
4. Make `ghcr.io/metabrain-labs/echowave-api` public.
5. Retain every tag/digest referenced by a Release.
6. Enable immutable Releases and prohibit deleting, moving, or reusing published stable tags.

The first GHCR package may be private. Anonymous-access gates intentionally stop publication until an administrator makes it permanently public and reruns the failed workflow.

## 9. Publish a version

### 9.1 Version and rollback metadata

Set the same `X.Y.Z` in root, API, mobile, and contracts `package.json`, Expo `apps/mobile/app.json`, and `deploy/release/release.json`. Set `minimumDirectRollbackVersion` to current version for the first Release, or no higher than the previous stable version thereafter. Migrations must follow expand-contract so at least N-1 remains startable.

### 9.2 Local validation

```bash
RELEASE_TAG=vX.Y.Z RELEASE_COMMIT=$(git rev-parse HEAD) RELEASE_MAIN_REF=HEAD pnpm release:validate
pnpm check
```

```powershell
$env:RELEASE_TAG = "vX.Y.Z"
$env:RELEASE_COMMIT = git rev-parse HEAD
$env:RELEASE_MAIN_REF = "HEAD"
pnpm release:validate
pnpm check
```

`RELEASE_MAIN_REF=HEAD` is local-only; the workflow requires the tag commit in remote `origin/main` history.

### 9.3 Tag

After the version commit is merged to `main` and CI passes:

```bash
git switch main
git pull --ff-only
git tag -a vX.Y.Z -m "EchoWave vX.Y.Z"
git push origin vX.Y.Z
```

Do not tag a feature branch or publish prerelease/`latest` tags through the stable workflow.

### 9.4 Workflow result

The Release workflow validates metadata, runs `pnpm check`, builds and verifies a signed APK, publishes amd64/arm64 immutable GHCR images, verifies runtime dependencies and anonymous pulls, creates the Server ZIP/manifest/checksums, runs current and N-1 integration smoke tests, then publishes a complete draft. Failure before completion publishes nothing. Never rebuild an existing public Release; issue a new patch version.

## 10. Troubleshooting

- Phone cannot connect: use the Server LAN IP, same network, healthy Compose API, and a LAN-scoped firewall rule; public use requires HTTPS.
- `migrate` failed: inspect `docker compose logs migrate`; preserve backup/config/logs and never bypass migration.
- `docker compose pull` denied: GHCR is private or unreachable; administrators must make the package public, and users should not need a maintainer token.
- Older APK cannot install over newer: uninstall first after recording the Server address.
- Old Release/image deletion: prohibited; historical tags, assets, and referenced digests are part of rollback.

## 11. Stop and uninstall

`docker compose down` preserves PostgreSQL, audio, configuration, and credentials. `docker compose down -v --remove-orphans` irreversibly deletes PostgreSQL/audio volumes and is allowed only after a verified backup and explicit discard decision. Never run global volume pruning. Remove only this installation's directory, Nginx site, and `certbot delete --cert-name <CERT_NAME>` certificate; do not uninstall shared Docker, Nginx, or FFmpeg.
