# EchoWave Server v{{VERSION}}

**English** | [简体中文](./README.zh-CN.md)

This bundle pins `{{IMAGE_REFERENCE}}` and runs on Linux amd64, Linux arm64, and Docker Desktop capable of the corresponding Linux containers. Never replace the Compose digest with `latest`.

## First installation

1. Copy `api.env.example` to `api.env`; replace the database password, `CREDENTIAL_MASTER_KEY`, and `CONFIGURATION_ADMIN_TOKEN`.
2. For a Local Credential Provider, place `credentials.yaml` at `.data/secrets/credentials.yaml`.
3. Run:

   ```bash
   docker compose config
   docker compose pull
   docker compose up -d
   docker compose ps
   ```

4. Confirm `http://localhost:3001/health` returns `version={{VERSION}}` and `status=ok`.
5. Under **More → AI Configuration**, create DashScope and DeepSeek logical connections; hybrid/object-storage modes also require Alibaba Cloud OSS. Select lightweight local, hybrid, or object storage under **More → Runtime Mode**.

HTTP is permitted on localhost and trusted LANs. Every cloud or public App Server requires an HTTPS reverse proxy, restricted 443 access, and no public 3001/5432. EchoWave still uses a fixed development tenant; HTTPS does not replace authentication, RBAC, or rate limits. See the complete [Server Deployment guide](https://github.com/MetaBrain-Labs/EchoWave/blob/main/docs/server-deployment.md).

## Backup before upgrade

Stop writes and create a PostgreSQL custom-format backup before replacing `compose.yaml`:

```bash
mkdir -p backups
docker compose exec -T postgres sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump --format=custom --no-owner --no-acl -U "$POSTGRES_USER" "$POSTGRES_DB" --file=/tmp/echowave-backup.dump'
docker compose cp postgres:/tmp/echowave-backup.dump backups/echowave-before-v{{VERSION}}.dump
docker compose exec -T postgres rm -f /tmp/echowave-backup.dump
test -s backups/echowave-before-v{{VERSION}}.dump
```

In PowerShell, create `backups` with `New-Item -ItemType Directory -Force backups` and confirm `(Get-Item backups/echowave-before-v{{VERSION}}.dump).Length` is nonzero. Protect the backup as sensitive data and retain its original `CREDENTIAL_MASTER_KEY`.

After verification, extract the new ZIP into the installation directory while preserving `api.env`, `.data/secrets`, and backups, then run `docker compose pull` and `docker compose up -d`.

## Rollback

The earliest Server version directly compatible with this database is `v{{MINIMUM_DIRECT_ROLLBACK_VERSION}}`.

- For a target at or above that version, download its Server ZIP, preserve `api.env` and `.data/secrets`, replace `compose.yaml`, then run `docker compose pull && docker compose up -d`.
- For an earlier target, stop API and restore the pre-upgrade backup; never let an old Server read a newer incompatible database.

Restoring overwrites current database objects. Verify the path and target instance first:

```bash
docker compose stop api
docker compose cp backups/echowave-before-v{{VERSION}}.dump postgres:/tmp/echowave-restore.dump
docker compose exec -T postgres sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_restore --exit-on-error --clean --if-exists --no-owner --no-acl -U "$POSTGRES_USER" -d "$POSTGRES_DB" /tmp/echowave-restore.dump'
docker compose exec -T postgres rm -f /tmp/echowave-restore.dump
docker compose up -d
```

Verify `/health`, `/api/hello`, groups, and knowledge bases. Database restore discards changes after the backup; the audio volume is neither removed nor restored automatically.

## Stop and uninstall

`docker compose down` stops the installation while preserving data. Only after a verified backup and an explicit decision to discard all data may you run `docker compose down -v --remove-orphans`; `-v` irreversibly deletes PostgreSQL and audio volumes. Never run global `docker system prune -a --volumes` or uninstall shared Docker/reverse-proxy services.
