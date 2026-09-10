# EchoWave Server Deployment

**English** | [简体中文](./server-deployment.zh-CN.md)

This is the primary EchoWave Server deployment entry point. The Ubuntu 22.04 x86_64 source flow is based on a real cloud deployment and rechecked against the current `compose.yaml`, environment templates, and migrations. The Windows flow targets Windows 10/11 with Docker Desktop Linux containers on localhost or a trusted LAN. One-off failures, real addresses, and temporary workarounds are not project defaults.

> [!IMPORTANT]
> EchoWave currently uses a fixed development tenant and has no real authentication, RBAC, rate limiting, or complete public-internet protection. HTTP is allowed only on localhost or a trusted private network. Every cloud or public App Server must use HTTPS and restrict access to port 443. HTTPS protects transport; it does not replace application authorization.

## 1. Choose an installation path

| Path                       | Intended user                 | Server source                                        | Upgrade method                                                                      |
| -------------------------- | ----------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Release Server ZIP         | Ordinary self-hosted users    | Fixed image digest in a GitHub Release Server bundle | Verify the new Release, back up, replace package files, then `docker compose pull`  |
| Ubuntu 22.04 x86_64 source | Maintainers, testers, forks   | Clone and build locally                              | Back up, `git pull --ff-only`, compare configuration, rebuild                       |
| Windows Docker Desktop     | Local trials and trusted LANs | Release Server ZIP or source clone                   | Follow the selected source; this guide does not make Windows a public Server target |

Prefer the [GitHub Release Guide](./releases.md) for stable versions. Source branches can change and are intended for preview, verification, and maintained forks.

## 2. Choose an audio runtime mode

Every mode stores transcripts, analyses, job state, and configuration revisions in PostgreSQL.

| Mode                                  | Source audio                                           | OSS                 | Best fit                                  | Main limitation                                                                                                           |
| ------------------------------------- | ------------------------------------------------------ | ------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Lightweight local `lightweight_local` | API temporary storage, removed after processing/expiry | None                | Trial and low storage cost                | No playback after cleanup; reruns require the same file; disabled acoustic emotion cannot be added later to that revision |
| Hybrid `hybrid`                       | `AUDIO_STORAGE_DIR`; `echowave_audio` Docker volume    | `audio_staging`     | Default, long-term local source retention | Single API instance; back up the local volume                                                                             |
| Object storage `object_storage`       | `audio_primary_storage` OSS                            | Primary and staging | Larger or longer-lived managed audio      | Requires correct bucket, credential, and lifecycle configuration; API is still single-instance                            |

Configure **More → Runtime Mode** with `CONFIGURATION_ADMIN_TOKEN`. A change affects only assets created afterward and never migrates or deletes existing assets. See [Audio Runtime Modes](./audio-runtime-modes.md).

## 3. Ubuntu 22.04 x86_64 source deployment

### 3.1 Prepare the host

Install Git, Docker Engine, and Docker Compose v2 following the current [Docker Engine for Ubuntu](https://docs.docker.com/engine/install/ubuntu/) instructions.

```bash
git --version
docker version
docker compose version
```

Log in again after joining the `docker` group. Do not hide a persistent permission problem by operating permanently from a root shell.

### 3.2 Clone

```bash
sudo mkdir -p /opt/echowave
sudo chown "$USER":"$USER" /opt/echowave
git clone https://github.com/MetaBrain-Labs/EchoWave.git /opt/echowave
cd /opt/echowave
```

For long-lived instances, use a verified tag after stable releases exist or use the Release Server ZIP. Do not treat `main` as immutable production input.

### 3.3 Configure the Server

```bash
cp deploy/self-hosted/api.env.example deploy/self-hosted/api.env
openssl rand -hex 24
openssl rand -base64 32
openssl rand -hex 32
```

Write the independent outputs to:

```dotenv
POSTGRES_PASSWORD=<independent random database password>
CREDENTIAL_MASTER_KEY=<canonical Base64 for 32 random bytes>
CONFIGURATION_ADMIN_TOKEN=<independent token of at least 32 random characters>
```

Unless the current example changes, preserve the container defaults:

```dotenv
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_USER=echowave
POSTGRES_DB=echowave
FFMPEG_PATH=/usr/bin/ffmpeg
PUSH_NOTIFICATIONS_ENABLED=false
```

`REDIS_*` is reserved configuration; no Redis container is currently required. `api.env` is Git-ignored and must never be attached to an issue, log, or screenshot.

### 3.4 Choose Credential storage

HTTPS or localhost may submit encrypted Database Credentials through **More → AI Configuration**. Remote HTTP cannot submit a secret and must use local `credentials.yaml`.

```bash
mkdir -p deploy/self-hosted/.data/secrets
cp deploy/self-hosted/credentials.yaml.example \
  deploy/self-hosted/.data/secrets/credentials.yaml
chmod 600 deploy/self-hosted/.data/secrets/credentials.yaml
```

Edit the file and select the matching Local-file alias in the App. Polling mode does not need `eventBridgeCallbackToken`; configure it only when EventBridge callback mode is intentionally enabled. See [Configuration and Credentials](./configuration.md).

### 3.5 Build and start

```bash
docker compose config
docker compose build --no-cache
docker compose up -d --no-build
docker compose ps -a
```

When default npm or Debian sources are unreliable, set build arguments only for that build:

```bash
NPM_REGISTRY=https://registry.npmmirror.com \
DEBIAN_MIRROR=http://mirrors.cloud.tencent.com/debian \
DEBIAN_SECURITY_MIRROR=http://mirrors.cloud.tencent.com/debian-security \
docker compose build --no-cache
```

Compose waits for healthy PostgreSQL, successful one-shot `migrate`, then starts `api`. Never bypass a failed migration:

```bash
docker compose logs migrate
docker compose logs --tail=200 api
```

`001_rag.sql` creates the `vector` extension automatically; manual extension creation is not a standard step.

### 3.6 Verify database and API

Do not use a fixed table count. Check schemas, the development tenant, vector, migration logs, and API status:

```bash
docker compose exec postgres sh -lc \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\\dn"'
docker compose exec postgres sh -lc \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\\dt public.*"'
docker compose exec postgres sh -lc \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT id, name FROM public.tenants;"'
docker compose exec postgres sh -lc \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\\dx vector"'

curl http://127.0.0.1:3001/health
curl http://127.0.0.1:3001/api/hello
```

`/health` must identify EchoWave API version 1 with `status=ok`; `/api/hello` must return `{ "ok": true, "service": "echowave-api", "message": "HelloWorld" }`.

### 3.7 Public hosts require Nginx and HTTPS

The root Compose maps host `<API_PORT>` to container 3001. Security groups and host firewalls must keep 3001 and 5432 off the public internet. Nginx reaches `127.0.0.1:3001`; expose only port 80 when needed for certificate validation and tightly restricted port 443.

```bash
sudo apt update
sudo apt install -y nginx
sudo systemctl enable --now nginx
```

Create `/etc/nginx/sites-available/echowave` with an initial HTTP validation proxy:

```nginx
server {
    listen 80;
    server_name <PUBLIC_HOST>;
    client_max_body_size 1g;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/echowave /etc/nginx/sites-enabled/echowave
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

#### Domain certificate (preferred)

Point A/AAAA records to the host and verify port 80, then use a currently supported Certbot installation:

```bash
sudo certbot --nginx -d <PUBLIC_DOMAIN>
sudo certbot renew --dry-run
```

#### Let’s Encrypt public IP certificate

Let’s Encrypt supports IPv4/IPv6 address certificates using the `shortlived` profile. They are valid for 160 hours and require automatic renewal plus an Nginx reload hook. Certbot webroot support for IP certificates requires 5.4 or later. Current Nginx/Apache installers do not install IP certificates automatically.

```bash
certbot --version
sudo certbot certonly --staging \
  --preferred-profile shortlived \
  --webroot \
  --webroot-path /var/www/html \
  --ip-address <PUBLIC_IP>
```

After staging succeeds, remove `--staging`. Reference `/etc/letsencrypt/live/<PUBLIC_IP>/fullchain.pem` and `privkey.pem` explicitly. Create the renewal hook:

```bash
sudo install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
sudo tee /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh >/dev/null <<'EOF'
#!/bin/sh
systemctl reload nginx
EOF
sudo chmod 755 /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
sudo certbot renew --dry-run
```

Confirm the Certbot renew timer is enabled. See [IP certificate GA](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability.html) and [Certbot shorter/IP certificates](https://letsencrypt.org/2026/03/11/shorter-certs-certbot).

#### Final TLS configuration

Replace the initial public HTTP API proxy. Port 80 serves ACME and redirects everything else; 443 proxies the API:

```nginx
server {
    listen 80;
    server_name <PUBLIC_HOST>;
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl;
    server_name <PUBLIC_HOST>;
    ssl_certificate <FULLCHAIN_PATH>;
    ssl_certificate_key <PRIVATE_KEY_PATH>;
    client_max_body_size 1g;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

```bash
sudo nginx -t
sudo systemctl reload nginx
curl https://<PUBLIC_HOST>/health
```

### 3.8 Trusted proxy

Only the real Nginx-to-Node peer belongs in `TRUSTED_PROXY_CIDRS`. Never enter the phone, public clients, the entire internet, or an unverified subnet.

```bash
docker network inspect echowave_default \
  --format '{{range .IPAM.Config}}Subnet={{.Subnet}} Gateway={{.Gateway}}{{end}}'
```

After confirming the API sees the Compose gateway, set its exact address, for example `TRUSTED_PROXY_CIDRS=172.18.0.1/32`, then recreate API:

```bash
docker compose up -d --force-recreate api
curl https://<PUBLIC_HOST>/api/settings/transport-security
```

Expected: `mode=trusted_proxy_https`, `secretSubmissionAllowed=true`, `warning=null`. Fix proxy headers and the exact peer when it differs; never widen the CIDR to bypass validation.

### 3.9 Network and App connection

Recommended preview rules: SSH 22 from an administrator's fixed IP, 80 only for validation/redirect, 443 from the smallest test-device source range, and no public 3001 or 5432. Enter `https://<PUBLIC_HOST>` in a Production APK without the internal API port.

## 4. Windows 10/11 localhost and trusted LAN

This section requires Docker Desktop with WSL 2 and Linux containers. It is not a public Windows Server reverse-proxy guide.

```powershell
git --version
docker version
docker compose version
Set-Location $env:USERPROFILE
git clone https://github.com/MetaBrain-Labs/EchoWave.git
Set-Location .\EchoWave
Copy-Item deploy\self-hosted\api.env.example deploy\self-hosted\api.env
New-Item -ItemType Directory -Force deploy\self-hosted\.data\secrets | Out-Null
Copy-Item deploy\self-hosted\credentials.yaml.example `
  deploy\self-hosted\.data\secrets\credentials.yaml
```

Generate values using APIs available in Windows PowerShell 5.1:

```powershell
$random = [Security.Cryptography.RandomNumberGenerator]::Create()
$databasePasswordBytes = [byte[]]::new(24)
$random.GetBytes($databasePasswordBytes)
-join ($databasePasswordBytes | ForEach-Object { $_.ToString('x2') })
$masterKeyBytes = [byte[]]::new(32)
$random.GetBytes($masterKeyBytes)
[Convert]::ToBase64String($masterKeyBytes)
$adminTokenBytes = [byte[]]::new(32)
$random.GetBytes($adminTokenBytes)
-join ($adminTokenBytes | ForEach-Object { $_.ToString('x2') })
$random.Dispose()
```

Write them to `POSTGRES_PASSWORD`, `CREDENTIAL_MASTER_KEY`, and `CONFIGURATION_ADMIN_TOKEN`. After editing local credentials, restrict ACL:

```powershell
$credentialFile = 'deploy\self-hosted\.data\secrets\credentials.yaml'
$currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
icacls $credentialFile /inheritance:r
icacls $credentialFile /grant:r "${currentIdentity}:(R)"
```

Build and verify:

```powershell
docker compose config
docker compose build --no-cache
docker compose up -d --no-build
docker compose ps -a
Invoke-RestMethod http://localhost:3001/health
Invoke-RestMethod http://localhost:3001/api/hello
```

For mirror-only builds, set `NPM_REGISTRY`, `DEBIAN_MIRROR`, and `DEBIAN_SECURITY_MIRROR` in the current PowerShell session, build, then remove those environment entries.

For a phone on the same trusted LAN, find the physical adapter IPv4 with `ipconfig`. In elevated PowerShell:

```powershell
New-NetFirewallRule `
  -DisplayName 'EchoWave API (Private LAN)' `
  -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3001 `
  -Profile Private -RemoteAddress LocalSubnet
```

Test `http://<SERVER_LAN_IP>:3001/health` in the phone browser, then use `http://<SERVER_LAN_IP>:3001` in EchoWave. Remove the rule when LAN access ends:

```powershell
Remove-NetFirewallRule -DisplayName 'EchoWave API (Private LAN)'
```

## 5. Configure AI and runtime mode

1. Open **More → AI Configuration** and enter `CONFIGURATION_ADMIN_TOKEN`.
2. Create DashScope for Qwen embedding, file transcription, and acoustic emotion.
3. Create a DeepSeek logical connection for knowledge answers, roles, speaker review, and business analysis. It may target official DeepSeek or Model Studio's compatible endpoint.
4. Add Alibaba Cloud OSS for hybrid or object-storage mode; lightweight local needs no OSS.
5. Verify capability bindings, then save the mode under **More → Runtime Mode**.

Editable model names do not imply arbitrary compatibility. Preserve current defaults unless a release documents an adapted model.

## 6. Backup and update

Before every update, preserve `api.env`, the Master Key, Local Credentials, persistent volumes, and a verified database backup:

```bash
mkdir -p backups
docker compose exec -T postgres sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump --format=custom --no-owner --no-acl -U "$POSTGRES_USER" "$POSTGRES_DB" --file=/tmp/echowave-backup.dump'
docker compose cp postgres:/tmp/echowave-backup.dump backups/echowave-before-update.dump
docker compose exec -T postgres rm -f /tmp/echowave-backup.dump
test -s backups/echowave-before-update.dump
```

Release users verify and replace the Server bundle, preserve local data/configuration, then run `docker compose config`, `docker compose pull`, and `docker compose up -d`. Source users verify a clean source tree, run `git pull --ff-only`, compare the new examples with existing configuration, add only missing keys, then `docker compose up -d --build`. Never recopy an example over a live configuration.

After update, inspect `docker compose ps -a`, migration/API logs, `/health`, and public `/api/settings/transport-security` where applicable.

## 7. Stop and uninstall

`docker compose down` removes containers and the Compose network but preserves PostgreSQL/audio volumes, configuration, and credentials.

> [!CAUTION]
> `docker compose down -v --rmi local --remove-orphans` irreversibly deletes EchoWave PostgreSQL and audio volumes. Run it only after verifying the exact instance and a non-empty recoverable backup.

Delete only Nginx sites, certificates, and installation paths owned by this instance. Use `certbot delete --cert-name <CERT_NAME>`. Never remove shared Docker/Nginx/FFmpeg or run global `docker system prune -a --volumes`.

## 8. Troubleshooting

```bash
docker compose ps -a
docker compose logs migrate
docker compose logs --tail=100 api
docker compose logs -f api
```

Keep logs, configuration, and backups before deciding to repair or roll back. Logs must not contain credentials, audio text, or unredacted provider responses. A phone cannot use the Server's localhost. On Windows verify Private network profile and LocalSubnet firewall scope; on cloud verify 443, certificate, Nginx, and narrow security-group source without exposing 3001.

## Appendix A: temporary v2rayN reverse proxy for restricted networks

Use this only when the cloud host cannot reach GitHub, Docker Hub, npm, or Debian sources. v2rayN must already listen locally, for example on 10808. Bind the remote endpoint to Server loopback only:

```powershell
curl.exe -x http://127.0.0.1:10808 -I https://github.com
ssh -NT `
  -o ExitOnForwardFailure=yes `
  -o ServerAliveInterval=30 `
  -R 127.0.0.1:18080:127.0.0.1:10808 `
  <SSH_USER>@<SERVER_IP>
```

On Ubuntu:

```bash
ss -lnt | grep 18080
curl -x http://127.0.0.1:18080 -I --connect-timeout 15 https://github.com
export HTTP_PROXY=http://127.0.0.1:18080
export HTTPS_PROXY=http://127.0.0.1:18080
export http_proxy=http://127.0.0.1:18080
export https_proxy=http://127.0.0.1:18080
```

Shell proxy variables do not configure the Docker daemon. If image pulls still fail, create `/etc/systemd/system/docker.service.d/echowave-proxy.conf` with loopback `HTTP_PROXY`/`HTTPS_PROXY`, reload systemd, restart Docker, and test a pull. After reboot or disconnect: start v2rayN, recreate SSH, verify the remote listener/curl, re-export shell variables or restart Docker with the retained daemon config, then resume the failed build/pull step.

Afterward unset shell variables, remove only `echowave-proxy.conf`, reload/restart Docker, and press Ctrl+C in the Windows tunnel. The proxy must never listen outside Server `127.0.0.1:18080`.
