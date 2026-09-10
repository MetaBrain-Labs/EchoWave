# EchoWave Server v{{VERSION}}

[English](./README.md) | **简体中文**

本部署包固定使用镜像 `{{IMAGE_REFERENCE}}`，可在 Linux amd64、Linux arm64 以及支持相应
Linux 容器的 Docker Desktop 上运行。不要把 Compose 中的 digest 改成 `latest`。

## 首次安装

1. 把 `api.env.example` 复制为 `api.env`，替换数据库密码、`CREDENTIAL_MASTER_KEY` 和
   `CONFIGURATION_ADMIN_TOKEN`。
2. 如需 Local Credential Provider，把 `credentials.yaml` 放在
   `.data/secrets/credentials.yaml`。
3. 执行：

   ```bash
   docker compose config
   docker compose pull
   docker compose up -d
   docker compose ps
   ```

4. 确认 `http://localhost:3001/health` 返回 `version={{VERSION}}` 与 `status=ok`。
5. 在 App 的“更多 → AI 配置”中创建 DashScope、DeepSeek 逻辑连接；混合/对象存储模式还要配置阿里云 OSS。然后在“更多 → 运行模式”中选择轻量本地、混合或对象存储。

可信本机和局域网可以使用 HTTP。任何云服务器或公网 App 服务端必须使用 HTTPS 反向代理，限制 443 来源，并保持 3001/5432 不对公网开放。EchoWave 当前仍是固定开发租户预览版，HTTPS 不能替代尚未实现的鉴权、RBAC 和速率限制。完整 Ubuntu、Windows、证书和运行模式流程见 <https://github.com/MetaBrain-Labs/EchoWave/blob/main/docs/server-deployment.md>。

## 升级前备份

在替换 `compose.yaml` 前停止写入并创建 PostgreSQL custom-format 备份：

```bash
mkdir -p backups
docker compose exec -T postgres sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump --format=custom --no-owner --no-acl -U "$POSTGRES_USER" "$POSTGRES_DB" --file=/tmp/echowave-backup.dump'
docker compose cp postgres:/tmp/echowave-backup.dump backups/echowave-before-v{{VERSION}}.dump
docker compose exec -T postgres rm -f /tmp/echowave-backup.dump
test -s backups/echowave-before-v{{VERSION}}.dump
```

PowerShell 用 `New-Item -ItemType Directory -Force backups` 创建目录，并用
`(Get-Item backups/echowave-before-v{{VERSION}}.dump).Length` 确认文件不是空文件。备份包含
业务数据与加密后的 Credential；应按敏感数据保护，并同时保留原 `api.env` 中的 master key。

备份确认后，把新版本 ZIP 解压到当前安装目录。保留现有 `api.env`、`.data/secrets` 和备份，
然后执行 `docker compose pull` 与 `docker compose up -d`。

## 回退

本版本数据库允许直接回退的最低 Server 版本是 `v{{MINIMUM_DIRECT_ROLLBACK_VERSION}}`。

- 目标版本不低于该版本时，下载目标 Release 的 Server ZIP，保留当前 `api.env` 和
  `.data/secrets`，用旧包的 `compose.yaml` 替换当前文件，然后执行
  `docker compose pull && docker compose up -d`。
- 目标版本更早时，先停止 API，再恢复升级前备份；不要直接让旧 Server 读取新数据库。

恢复 custom-format 备份会覆盖当前数据库对象，应先确认文件路径和目标安装实例：

```bash
docker compose stop api
docker compose cp backups/echowave-before-v{{VERSION}}.dump postgres:/tmp/echowave-restore.dump
docker compose exec -T postgres sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_restore --exit-on-error --clean --if-exists --no-owner --no-acl -U "$POSTGRES_USER" -d "$POSTGRES_DB" /tmp/echowave-restore.dump'
docker compose exec -T postgres rm -f /tmp/echowave-restore.dump
docker compose up -d
```

恢复后检查 `/health`、`/api/hello`，再从 App 验证分组和知识库。回退数据库会丢弃备份时点
之后的数据库变更；音频卷不会被自动删除或还原。

## 停用与卸载

`docker compose down` 只停用服务并保留数据。只有完成并验证备份、确认不再需要任何数据后，才能运行 `docker compose down -v --remove-orphans`；其中 `-v` 会不可逆地删除 PostgreSQL 和音频 volume。不要使用全局 `docker system prune -a --volumes`，也不要卸载服务器上可能由其他应用共享的 Docker 或反向代理。
