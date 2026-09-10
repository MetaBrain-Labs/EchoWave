# GitHub Release 使用手册

[English](./releases.md) | **简体中文**

本文说明如何从 GitHub Release 下载 EchoWave Android App 和 Server、完成校验与首次安装，
以及如何升级、回退和发布新版本。

EchoWave 的稳定版本以 `vMAJOR.MINOR.PATCH` Tag 和对应的 GitHub Release 为唯一分发入口。
GitHub 自动生成的 Source code 压缩包不是 Server 安装包。

> EchoWave 当前是固定开发租户的预览版本，没有真实鉴权、RBAC 或速率限制。可信本机和局域网
> 可以使用 HTTP；任何云服务器或公网 App 服务端都必须使用 HTTPS、反向代理和最小网络访问
> 范围，并保持 3001/5432 不对公网开放。这些措施仍不能把当前版本变成公开多用户服务。

## 1. 你需要阅读哪一部分

- 只安装 Android App：阅读第 2、3、5 节。
- 部署或升级 Server：阅读第 2、3、4、6、7 节。
- 维护仓库并发布新版本：阅读第 8、9 节。

Ubuntu 22.04 x86_64 源码部署、Windows Docker Desktop、运行模式、HTTPS 和完整停用/卸载说明见 [Server 部署指南](./server-deployment.md)。

## 2. 选择并下载版本

打开 [EchoWave Releases](https://github.com/MetaBrain-Labs/EchoWave/releases)，选择需要的稳定
版本。最新版本适合首次安装；历史版本用于回退或复现旧环境。

每个完整 Release 固定提供：

| 文件                           | 用途                                                   |
| ------------------------------ | ------------------------------------------------------ |
| `EchoWave-android-vX.Y.Z.apk`  | Android 安装包                                         |
| `EchoWave-server-vX.Y.Z.zip`   | 已固定镜像 digest 的 Docker Compose Server 包          |
| `EchoWave-release-vX.Y.Z.json` | Commit、镜像、平台、migration 和回退窗口等机器可读信息 |
| `SHA256SUMS-vX.Y.Z.txt`        | APK、Server ZIP 和 manifest 的 SHA-256                 |

同一次安装使用的 App 和 Server 最好来自同一个 Release。Server 回退时必须另外遵守第 7 节
的数据库兼容边界。

文档中的 `X.Y.Z` 是占位符。例如使用 `v0.1.0` 时，应把
`EchoWave-server-vX.Y.Z.zip` 替换为 `EchoWave-server-v0.1.0.zip`。

## 3. 校验下载文件

校验失败时不要安装或运行文件，应删除后从本仓库 Release 重新下载。

如果下载了 APK、Server ZIP 和 manifest 三个文件，Linux 可以一次校验全部文件：

```bash
sha256sum --check SHA256SUMS-vX.Y.Z.txt
```

macOS：

```bash
shasum -a 256 --check SHA256SUMS-vX.Y.Z.txt
```

只下载了 Server ZIP 时，Linux 可以校验单个文件：

```bash
grep 'EchoWave-server-vX.Y.Z.zip' SHA256SUMS-vX.Y.Z.txt | sha256sum --check -
```

macOS 把命令末尾的 `sha256sum --check -` 替换为 `shasum -a 256 --check`。

PowerShell：

```powershell
$version = "X.Y.Z"
$file = "EchoWave-server-v$version.zip"
$line = (Select-String -Path "SHA256SUMS-v$version.txt" -Pattern ([regex]::Escape($file))).Line
$expected = $line.Split(' ', [System.StringSplitOptions]::RemoveEmptyEntries)[0]
$actual = (Get-FileHash $file -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $expected) { throw "Checksum mismatch: $file" }
Write-Host "Checksum verified: $file"
```

校验 APK 时，把 `$file` 改为 `EchoWave-android-vX.Y.Z.apk`。

## 4. 首次部署 Server

### 4.1 准备环境

准备一台能够长期保存数据的电脑或服务器：

- Linux、macOS，或者使用 Linux containers 的 Windows Docker Desktop。
- Docker Engine 或 Docker Desktop，并启用 Docker Compose v2。
- 能够访问 GitHub Container Registry `ghcr.io`。
- 本地部署时，Android 手机和 Server 位于同一个可信局域网，3001 只允许该局域网访问。
- 云服务器部署时，先准备 HTTPS 反向代理和最小化安全组；3001 和 5432 不允许公网访问。

先确认 Docker 可用：

```bash
docker version
docker compose version
```

### 4.2 解压并配置

把 `EchoWave-server-vX.Y.Z.zip` 解压到固定安装目录。以后升级仍使用这个目录，以便继续使用
原有 `api.env` 和 `.data/secrets`。

Linux/macOS：

```bash
mkdir -p echowave
unzip EchoWave-server-vX.Y.Z.zip -d echowave
cd echowave
cp api.env.example api.env
mkdir -p .data/secrets
```

PowerShell：

```powershell
Expand-Archive .\EchoWave-server-vX.Y.Z.zip -DestinationPath .\echowave
Set-Location .\echowave
Copy-Item .\api.env.example .\api.env
New-Item -ItemType Directory -Force .\.data\secrets | Out-Null
```

打开 `api.env`，至少替换以下三项：

- `POSTGRES_PASSWORD`：PostgreSQL 强密码。
- `CREDENTIAL_MASTER_KEY`：恰好 32 个随机字节的 Base64，用于加密 Credential。
- `CONFIGURATION_ADMIN_TOKEN`：至少 32 个随机字符的管理令牌。

Linux/macOS 可以分别生成两个随机值：

```bash
openssl rand -base64 32
openssl rand -base64 32
```

PowerShell：

```powershell
$random = [Security.Cryptography.RandomNumberGenerator]::Create()
$bytes = [byte[]]::new(32)
$random.GetBytes($bytes)
[Convert]::ToBase64String($bytes)
$random.Dispose()
```

每次运行 PowerShell 命令会生成一个新值。不要把 `api.env`、真实密钥或
`.data/secrets/credentials.yaml` 提交到 Git。

### 4.3 启动并验收

```bash
docker compose config
docker compose pull
docker compose up -d
docker compose ps
```

等待容器健康后检查：

```bash
curl http://localhost:3001/health
curl http://localhost:3001/api/hello
```

`/health` 应返回 `status: "ok"`，其中 `version` 应等于当前 Release 版本；`/api/hello`
应返回 `message: "HelloWorld"`。

常用运维命令：

```bash
docker compose logs -f api
docker compose restart api
docker compose stop
docker compose up -d
```

不要使用 `docker compose down --volumes`，该命令会删除 PostgreSQL 和音频持久卷。

发布包中的 Compose 使用固定 project `echowave` 和固定 volume 键。`api` 与 `migrate` 使用
同一个不可变镜像 digest，不包含 `build:`，也不使用 `latest`。

## 5. 安装 Android App

1. 在 Android 手机上下载并校验 `EchoWave-android-vX.Y.Z.apk`。
2. 如果系统禁止浏览器安装 APK，按 Android 提示临时允许该下载来源安装未知应用。
3. 安装并打开 EchoWave。
4. 在首次启动页输入 Server 地址，例如 `http://192.168.1.20:3001`。
5. 完成连接测试后再进入 App。

实体手机不能使用 `localhost` 或 `127.0.0.1` 访问电脑上的 Server；请使用 Server 的局域网
IPv4 地址，并确认主机防火墙允许可信局域网访问 3001 端口。

### App 回退

Android 不允许普通用户用较低 `versionCode` 覆盖较新 App：

1. 记录当前 Server 地址。
2. 卸载当前 EchoWave App。
3. 从目标历史 Release 下载并校验旧 APK。
4. 安装旧 APK 并重新填写 Server 地址。

卸载会清除 App 的服务器地址和其他本地偏好，但不会删除 Server 中的 PostgreSQL、音频或
分析数据。

## 6. 升级 Server

### 6.1 强制备份

每次升级前都必须备份数据库，并保留当前 `api.env`、`CREDENTIAL_MASTER_KEY`、本地 secrets
和当前 Server ZIP。

在当前安装目录执行：

```bash
mkdir -p backups
docker compose exec -T postgres sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump --format=custom --no-owner --no-acl -U "$POSTGRES_USER" "$POSTGRES_DB" --file=/tmp/echowave-backup.dump'
docker compose cp postgres:/tmp/echowave-backup.dump backups/echowave-before-vX.Y.Z.dump
docker compose exec -T postgres rm -f /tmp/echowave-backup.dump
test -s backups/echowave-before-vX.Y.Z.dump
```

PowerShell 使用以下命令确认备份不为空：

```powershell
New-Item -ItemType Directory -Force .\backups | Out-Null
# 执行上面的 docker compose exec 和 docker compose cp 后：
if ((Get-Item .\backups\echowave-before-vX.Y.Z.dump).Length -le 0) {
  throw "Database backup is empty"
}
```

备份包含业务数据和加密后的 Credential，应作为敏感数据保护。没有原
`CREDENTIAL_MASTER_KEY` 时，恢复数据库后也无法解密已有 Credential。

### 6.2 替换版本

1. 下载并校验新 Release 的 Server ZIP、manifest 和 checksum。
2. 确认上一步数据库备份存在且非空。
3. 保存当前 `compose.yaml` 和包内 README。
4. 把新 ZIP 解压到当前安装目录，只替换发布包文件。
5. 不要覆盖现有 `api.env`、`.data/secrets` 和 `backups`。
6. 执行：

```bash
docker compose config
docker compose pull
docker compose up -d
docker compose ps
curl http://localhost:3001/health
curl http://localhost:3001/api/hello
```

`migrate` 服务成功后 API 才会启动。如果升级失败，先查看：

```bash
docker compose ps -a
docker compose logs migrate
docker compose logs api
```

启动成功后，在 App 的“更多 → AI 配置”中创建 DashScope、DeepSeek 逻辑连接，并按运行模式决定是否配置阿里云 OSS。轻量本地模式不需要 OSS；默认混合模式需要 `audio_staging`；对象存储模式还需要 `audio_primary_storage`。随后在“更多 → 运行模式”中保存选择。当前默认模型和使用百炼承载 DeepSeek 的方式见[配置与 Credential 指南](./configuration.md)。

## 7. 回退 Server

先打开当前 Release 的 `EchoWave-release-vX.Y.Z.json`，读取：

```json
{
  "database": {
    "minimumDirectRollbackVersion": "X.Y.Z"
  }
}
```

假设当前版本声明的最低直接回退版本是 `1.2.0`：

- 回退到 `1.2.0` 或更高版本：允许直接回退。
- 回退到 `1.1.9` 或更低版本：禁止直接连接当前数据库，必须恢复升级前备份。

### 7.1 兼容窗口内直接回退

1. 下载并校验目标历史 Release 的 Server ZIP。
2. 保留当前 `api.env`、`.data/secrets`、PostgreSQL volume 和音频 volume。
3. 停止当前 API：

   ```bash
   docker compose stop api
   ```

4. 用旧 ZIP 中的 `compose.yaml` 和 README 替换当前版本文件。
5. 拉取旧 digest 并启动：

   ```bash
   docker compose pull
   docker compose up -d
   docker compose ps
   curl http://localhost:3001/health
   curl http://localhost:3001/api/hello
   ```

6. 确认 `/health.version` 是目标版本，并从 App 验证分组和知识库。

### 7.2 超出兼容窗口时恢复备份

先确认备份路径和当前操作的确实是目标 EchoWave 实例。恢复会覆盖当前数据库对象，并丢弃
备份时点之后的数据库变化：

```bash
docker compose stop api
docker compose cp backups/echowave-before-vX.Y.Z.dump postgres:/tmp/echowave-restore.dump
docker compose exec -T postgres sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_restore --exit-on-error --clean --if-exists --no-owner --no-acl -U "$POSTGRES_USER" -d "$POSTGRES_DB" /tmp/echowave-restore.dump'
docker compose exec -T postgres rm -f /tmp/echowave-restore.dump
```

然后换回目标历史 Release 的 `compose.yaml` 并启动：

```bash
docker compose pull
docker compose up -d
docker compose ps
```

音频 volume 不会自动回退，可能留下不再被旧数据库引用的文件；发布流程不会自动删除这些
文件。仓库不提供通用 down migration。

## 8. 发布维护者的一次性配置

仓库管理员需要完成：

1. 在 GitHub `release` Environment 或仓库 Actions Secrets 中配置 `EXPO_TOKEN`。
2. 在 EAS Production 环境配置 `GOOGLE_SERVICES_JSON`，并确认 Android Keystore 与 FCM
   Credentials 已建立；签名私钥不得进入仓库或 GitHub Secrets。
3. 确保 Actions 可以写入 Repository contents 和 Packages。工作流只申请发布所需权限。
4. 将 `ghcr.io/metabrain-labs/echowave-api` 设置为 public。
5. 配置 GHCR 保留规则，不得删除仍被 GitHub Release 引用的 Tag 或 digest。
6. 在仓库设置中启用 immutable releases，并禁止删除、移动或复用已发布的稳定 Tag。

GHCR 容器包第一次创建时可能仍是 private。此时发布工作流会在创建 GitHub Release 前被匿名
访问门禁拦截。管理员把 Package 永久设为 public 后，重新运行失败的 Actions workflow。

## 9. 发布新版本

### 9.1 更新版本和回退元数据

把以下六个位置更新为同一个 `X.Y.Z`：

1. 根目录 `package.json`。
2. `apps/api/package.json`。
3. `apps/mobile/package.json`。
4. `packages/contracts/package.json`。
5. `apps/mobile/app.json` 中的 Expo `version`。
6. `deploy/release/release.json` 中的 `version`。

同时更新 `deploy/release/release.json` 的 `minimumDirectRollbackVersion`：

- 首个 Release：必须等于当前版本。
- 后续 Release：不得高于上一稳定版本，确保至少支持 N-1 直接回退。

普通 migration 必须采用 expand-contract，使上一稳定 Server 能在升级后的数据库上启动。发布
manifest 会自动记录仓库内全部 migration 和相对上一稳定 Tag 本次新增的 migration。

### 9.2 本地验证

在版本提交上执行：

```bash
RELEASE_TAG=vX.Y.Z RELEASE_COMMIT=$(git rev-parse HEAD) RELEASE_MAIN_REF=HEAD pnpm release:validate
pnpm check
```

PowerShell：

```powershell
$env:RELEASE_TAG = "vX.Y.Z"
$env:RELEASE_COMMIT = git rev-parse HEAD
$env:RELEASE_MAIN_REF = "HEAD"
pnpm release:validate
pnpm check
```

本地 `RELEASE_MAIN_REF=HEAD` 只用于验证当前版本提交。正式工作流仍会强制检查 Tag 提交属于
远端 `origin/main` 历史。

### 9.3 合并并推送 Tag

版本变更合并到 `main` 且 CI 通过后：

```bash
git switch main
git pull --ff-only
git tag -a vX.Y.Z -m "EchoWave vX.Y.Z"
git push origin vX.Y.Z
```

不要从功能分支创建 Tag，也不要推送 `v1.2.3-rc.1`、`latest` 或其他非稳定版本 Tag。

### 9.4 查看发布结果

打开仓库 Actions 的 `Release` workflow。它会依次完成：

1. 校验 Tag、`main` 归属、所有版本来源和回退下限。
2. 执行完整 `pnpm check`。
3. 使用 EAS 构建签名 APK，并验证签名、包名和 `versionName`。
4. 构建并推送 `linux/amd64`、`linux/arm64` GHCR 镜像。
5. 验证 Node、FFmpeg、`onnxruntime-node` 和匿名 GHCR 拉取。
6. 生成 Server ZIP、Release manifest 和 SHA-256。
7. 运行当前版本集成烟测及 N-1 直接回退烟测。
8. 创建完整 Draft，上传四个资产，最后公开 Release。

任何步骤失败都不会公开不完整 Release。已公开的 Release 不允许覆盖或重建；修复发布问题后
应创建新的 Patch 版本，而不是复用旧 Tag。

## 10. 常见问题

### 手机无法连接 Server

- 不要填写 `localhost`，改用 Server 的局域网 IPv4 地址。
- 确认手机与 Server 在同一局域网。
- 确认 `docker compose ps` 中 API 健康。
- 在 Server 本机先访问 `/health`，再检查主机防火墙的 3001 端口规则。

### `migrate` 失败，API 没有启动

运行 `docker compose logs migrate`。不要跳过 migration 强行启动 API。保留数据库备份、
`api.env` 和日志，再决定修复当前版本或按第 7 节回退。

### `docker compose pull` 返回 denied

GHCR 包还不是 public，或者当前网络无法访问 `ghcr.io`。管理员需要把
`metabrain-labs/echowave-api` Package 设为 public；普通用户不应依赖维护者个人 Token。

### APK 无法覆盖安装

如果目标 APK 比当前 App 旧，这是 Android 的正常降级限制。记录 Server 地址，卸载当前 App
后再安装旧 APK；服务器数据不会因此删除。

### 可以删除旧 Release 或旧镜像吗

不可以。历史 Tag、Release、APK、Server ZIP 和被 Release manifest 引用的镜像 digest 是回退
能力的一部分，必须永久保留。

## 11. 停用与卸载

暂时停用并保留 PostgreSQL、音频、配置和 Credential：

```bash
docker compose down
```

以后可以在同一安装目录执行 `docker compose up -d` 恢复。

> [!CAUTION]
> 只有确认所有 Server 数据都不再需要，并且已经验证备份后，才能使用下面的完全卸载命令。`-v` 会不可逆地删除 EchoWave 的 PostgreSQL 和音频 volume。

```bash
docker compose down -v --remove-orphans
```

Release 包使用远程不可变镜像，是否删除本机镜像应由部署者按实际 digest 决定，不要运行全局 `docker system prune -a --volumes`。随后只删除当前 EchoWave 安装目录及该实例独占的 Nginx site；Certbot 证书使用 `certbot delete --cert-name <CERT_NAME>`。不要卸载可能被其他应用使用的 Docker、Nginx 或 FFmpeg。
