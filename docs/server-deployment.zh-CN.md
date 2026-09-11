# EchoWave Server 部署指南

[English](./server-deployment.md) | **简体中文**

本文是 EchoWave Server 的部署主入口。Ubuntu 22.04 x86_64 源码流程来自一次真实云服务器部署，并已按当前仓库的 `compose.yaml`、环境模板和 migration 重新核对；Windows 流程面向 Windows 10/11、Docker Desktop Linux containers 和可信本地网络。本文不把单次故障、真实地址或临时 workaround 当成项目默认行为。

> [!IMPORTANT]
> EchoWave 当前使用固定开发租户，没有真实用户鉴权、RBAC、速率限制或完整公网防护。可信本机和局域网可以使用 HTTP；任何云服务器或公网 App 服务端都必须使用 HTTPS，并限制允许访问 443 的来源。HTTPS 只保护传输，不能替代应用级鉴权。

## 1. 先选择安装路径

| 路径                         | 适合谁                     | Server 来源                                   | 更新方式                                                       |
| ---------------------------- | -------------------------- | --------------------------------------------- | -------------------------------------------------------------- |
| Release Server ZIP           | 普通用户                   | GitHub Release 中固定镜像 digest 的 Server 包 | 下载并校验新 Release，备份后替换包文件并 `docker compose pull` |
| Ubuntu 22.04 x86_64 源码部署 | 维护者、测试者和 Fork 用户 | Clone 仓库并本机构建镜像                      | 备份后 `git pull --ff-only`，检查配置差异并重新构建            |
| Windows Docker Desktop       | 本机试用和可信局域网       | Release Server ZIP 或 Clone 源码              | 按所选来源更新，不把 Windows 主机作为本文的公网部署目标        |

正式版本优先使用 [GitHub Release 使用手册](./releases.md)中的 Server ZIP。源码部署会跟随分支变化，适合预览、验证和自行维护，不应把 `main` 当成不可变生产版本。

## 2. 选择音频运行模式

三种模式都把 Transcript、分析结果、任务状态和配置 revision 保存在 PostgreSQL。差异主要在原音频位置、OSS 依赖和清理行为。

| 模式                         | 原音频                                                   | OSS 要求                                          | 适合场景                                   | 主要限制                                                                              |
| ---------------------------- | -------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------- |
| 轻量本地 `lightweight_local` | API 临时目录，流程结束后清理                             | 不需要                                            | 快速试用、低存储成本、不希望长期保留原音频 | 清理后不能播放；重新转写要再次选择同一文件；若关闭声学情绪，之后不能补跑本次 revision |
| 混合 `hybrid`                | `AUDIO_STORAGE_DIR`，Docker 中为 `echowave_audio` volume | `audio_staging` 必需                              | 默认模式；希望本地长期保留原音频           | 当前仍要求单 API 实例；必须备份本地持久卷                                             |
| 对象存储 `object_storage`    | `audio_primary_storage` OSS                              | `audio_primary_storage` 和 `audio_staging` 都必需 | 原音频较多、希望交给对象存储管理           | 需要正确配置 Bucket、Credential 和保留策略；当前 API 仍是单实例                       |

三种模式都支持完成上传并成功创建/提交服务端任务后关闭 App，由服务端继续后台处理。轻量本地是“异步处理 + 临时本地存储”，成本最低但恢复能力最低；混合模式是“异步处理 + 持久本地存储 + OSS 中转”，作为默认方案平衡成本与可靠性；对象存储是“异步处理 + OSS 持久存储”，适合云部署和大规模音频，恢复能力最好。上传未完成时直接杀掉 App 不代表服务端已经接管。

在 App 的“更多 → 运行模式”中查看和修改模式。修改时需要 `CONFIGURATION_ADMIN_TOKEN`，并且只影响修改后创建的音频资产；已有资产不会被迁移或删除。详细生命周期见[音频运行模式](./audio-runtime-modes.zh-CN.md)。

## 3. Ubuntu 22.04 x86_64 源码部署

### 3.1 准备服务器

安装 Git、Docker Engine 与 Docker Compose v2，并确认当前账户可以运行 Docker。Docker 的官方安装步骤可能更新，应以 [Docker Engine for Ubuntu](https://docs.docker.com/engine/install/ubuntu/) 为准。

```bash
git --version
docker version
docker compose version
```

如果刚把当前用户加入 `docker` 组，需要重新登录 Shell；不要通过长期使用 root Shell 掩盖权限配置问题。

### 3.2 获取源码

```bash
sudo mkdir -p /opt/echowave
sudo chown "$USER":"$USER" /opt/echowave
git clone https://github.com/MetaBrain-Labs/EchoWave.git /opt/echowave
cd /opt/echowave
```

公开稳定版本后，长期运行实例应切换到经过校验的 Git Tag，或者改用 Release Server ZIP，不要无条件追踪 `main`。

### 3.3 创建 Server 配置

```bash
cp deploy/self-hosted/api.env.example deploy/self-hosted/api.env
```

分别生成数据库密码、Credential 加密主密钥和管理员令牌：

```bash
openssl rand -hex 24
openssl rand -base64 32
openssl rand -hex 32
```

编辑 `deploy/self-hosted/api.env`，至少替换：

```dotenv
POSTGRES_PASSWORD=<独立的数据库随机密码>
CREDENTIAL_MASTER_KEY=<32 个随机字节的标准 Base64>
CONFIGURATION_ADMIN_TOKEN=<至少 32 个随机字符的独立令牌>
```

保留下列容器内默认值，除非当前仓库的 example 已经改变：

```dotenv
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_USER=echowave
POSTGRES_DB=echowave
FFMPEG_PATH=/usr/bin/ffmpeg
PUSH_NOTIFICATIONS_ENABLED=false
```

`REDIS_*` 当前只是保留配置，不需要额外启动 Redis。`deploy/self-hosted/api.env` 已被 Git 忽略，不得提交或粘贴到 Issue、日志和截图中。

### 3.4 选择 Credential 存储方式

HTTPS 或 localhost 连接可以在 App 的“更多 → AI 配置”中写入加密的 Database Credential。远程 HTTP 不允许通过网络提交 Secret，必须使用服务器本地的 `credentials.yaml`。

创建 Local Credential 文件：

```bash
mkdir -p deploy/self-hosted/.data/secrets
cp deploy/self-hosted/credentials.yaml.example \
  deploy/self-hosted/.data/secrets/credentials.yaml
chmod 600 deploy/self-hosted/.data/secrets/credentials.yaml
```

编辑该文件后，在 App 中把对应连接的“Credential 来源”选为 Local file，并选择相同 alias。Polling 模式不需要 `eventBridgeCallbackToken`；只有明确启用 EventBridge 回调时才配置它。完整格式见[配置与 Credential 指南](./configuration.md)。

### 3.5 校验、构建并启动

```bash
docker compose config
docker compose build --no-cache
docker compose up -d --no-build
docker compose ps -a
```

构建阶段需要访问 npm registry 和 Debian 镜像。若服务器所在网络访问默认源不稳定，可以只为本次构建设置镜像参数：

```bash
NPM_REGISTRY=https://registry.npmmirror.com \
DEBIAN_MIRROR=http://mirrors.cloud.tencent.com/debian \
DEBIAN_SECURITY_MIRROR=http://mirrors.cloud.tencent.com/debian-security \
docker compose build --no-cache
```

Compose 的启动顺序为 PostgreSQL 健康、一次性 `migrate` 成功、API 启动。migration 失败时查看日志，不能绕过 migration 强行启动 API：

```bash
docker compose logs migrate
docker compose logs --tail=200 api
```

当前 `001_rag.sql` 会自动创建 `vector` 扩展，不需要在正常流程中手工创建扩展。

### 3.6 验证数据库和 API

不要用固定表数量判断成功；表数量会随着 migration 增加。检查 schema、开发租户和扩展：

```bash
docker compose exec postgres sh -lc \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\\dn"'

docker compose exec postgres sh -lc \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\\dt public.*"'

docker compose exec postgres sh -lc \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT id, name FROM public.tenants;"'

docker compose exec postgres sh -lc \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\\dx vector"'
```

关闭当前 Shell 的代理变量后再检查本机接口，避免本机请求被代理转发：

```bash
curl http://127.0.0.1:3001/health
curl http://127.0.0.1:3001/api/hello
```

`/health` 应包含 `name=EchoWave`、`service=echowave-api`、`apiVersion=1` 和 `status=ok`；`/api/hello` 应返回：

```json
{
  "ok": true,
  "service": "echowave-api",
  "message": "HelloWorld"
}
```

### 3.7 云服务器必须使用反向代理和 HTTPS

根 Compose 当前把宿主机 `<API_PORT>` 映射到容器 3001。云服务器安全组和主机防火墙不得向公网开放 3001 或 5432；Nginx 在宿主机通过 `127.0.0.1:3001` 访问 API，公网只开放验证所需的 80 和受限来源的 443。

安装并启动 Nginx：

```bash
sudo apt update
sudo apt install -y nginx
sudo systemctl enable --now nginx
```

创建 `/etc/nginx/sites-available/echowave`。先用 HTTP 完成反向代理和证书验证，`server_name` 使用域名或公网 IP：

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

启用配置：

```bash
sudo ln -s /etc/nginx/sites-available/echowave /etc/nginx/sites-enabled/echowave
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

#### 使用域名证书（推荐）

把域名 A/AAAA 记录指向服务器，确认解析和 80 端口验证可达，再使用当前受支持的 Certbot 安装方式申请证书。域名场景可使用 Nginx installer：

```bash
sudo certbot --nginx -d <PUBLIC_DOMAIN>
sudo certbot renew --dry-run
```

#### 没有域名时使用 Let’s Encrypt 公网 IP 证书

Let’s Encrypt 已公开提供 IPv4/IPv6 地址证书。IP 证书固定为 `shortlived` profile，有效期 160 小时，因此自动续期和 Nginx reload hook 是必要条件。Certbot 的 IP webroot 支持需要 5.4 或更高版本；先确认版本，不要使用 Ubuntu 22.04 仓库中的旧客户端假设该参数存在。

```bash
certbot --version

sudo certbot certonly --staging \
  --preferred-profile shortlived \
  --webroot \
  --webroot-path /var/www/html \
  --ip-address <PUBLIC_IP>
```

Staging 成功后去掉 `--staging` 获取受公众信任的证书。当前 Certbot 的 Nginx/Apache installer 不能自动安装 IP 证书，需要在 Nginx 中显式引用：

```nginx
ssl_certificate /etc/letsencrypt/live/<PUBLIC_IP>/fullchain.pem;
ssl_certificate_key /etc/letsencrypt/live/<PUBLIC_IP>/privkey.pem;
```

创建续期后重载 hook，确保新证书生效：

```bash
sudo install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
sudo tee /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh >/dev/null <<'EOF'
#!/bin/sh
systemctl reload nginx
EOF
sudo chmod 755 /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
sudo certbot renew --dry-run
```

同时检查 Certbot 安装方式已经启用周期性 renew timer。官方现状和限制见 [Let’s Encrypt IP 证书 GA 公告](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability.html)与 [Certbot IP 证书说明](https://letsencrypt.org/2026/03/11/shorter-certs-certbot)。

#### 完成 TLS Nginx 配置

```nginx
server {
    listen 80;
    server_name <PUBLIC_HOST>;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        return 301 https://$host$request_uri;
    }
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

取得证书后应使用上述 80 端口配置替换最初的 HTTP API 代理；除 ACME challenge 外，所有请求都跳转到 HTTPS，不能继续通过公网 HTTP 使用 API。

```bash
sudo nginx -t
sudo systemctl reload nginx
curl https://<PUBLIC_HOST>/health
```

### 3.8 配置可信代理

只有 Nginx 到 Node API 的真实来源地址可以进入 `TRUSTED_PROXY_CIDRS`。不要填写手机、公网客户端、整个互联网或未经确认的网段。

查看当前 Compose 网络：

```bash
docker network inspect echowave_default \
  --format '{{range .IPAM.Config}}Subnet={{.Subnet}} Gateway={{.Gateway}}{{end}}'
```

如果确认 Nginx 请求在 API 容器中显示为该网络 Gateway，例如 `172.18.0.1`，则在 `deploy/self-hosted/api.env` 中设置精确地址：

```dotenv
TRUSTED_PROXY_CIDRS=172.18.0.1/32
```

重新创建 API 让环境变量生效：

```bash
docker compose up -d --force-recreate api
```

通过公网 HTTPS 地址检查传输判断：

```bash
curl https://<PUBLIC_HOST>/api/settings/transport-security
```

期望结果为：

```json
{
  "mode": "trusted_proxy_https",
  "secretSubmissionAllowed": true,
  "warning": null
}
```

若结果不是该状态，先检查 Nginx 转发头、真实容器对端地址和 `TRUSTED_PROXY_CIDRS`，不要通过扩大 CIDR 绕过检查。

### 3.9 安全组与 App 连接

当前预览版本的建议规则：

| 端口 | 来源                                               |
| ---- | -------------------------------------------------- |
| 22   | 管理员固定公网 IP                                  |
| 80   | 证书验证需要的范围；不需要时关闭或只重定向到 HTTPS |
| 443  | 测试设备所在公网 IP `/32` 或其他最小可信范围       |
| 3001 | 不开放公网                                         |
| 5432 | 不开放公网                                         |

Production APK 首次启动时填写：

```text
https://<PUBLIC_HOST>
```

不要填写 `http://<PUBLIC_IP>:3001`，也不要把内部 API 端口附加到 Nginx 的 443 地址。旧 App 已保存其他地址时，使用“更多 → 服务状态”切换，或者清除应用数据后重新连接。

## 4. Windows 10/11 本机与可信局域网

本节只覆盖 Docker Desktop 使用 Linux containers 的本机或可信局域网部署，不把 Windows 主机作为公网 Server 指南。公网云服务器请使用上一节的 HTTPS 与网络访问控制。

### 4.1 前置条件和源码

安装 Git 与 Docker Desktop，启用 WSL 2 backend 和 Linux containers，然后在 PowerShell 检查：

```powershell
git --version
docker version
docker compose version
```

Clone 源码：

```powershell
Set-Location $env:USERPROFILE
git clone https://github.com/MetaBrain-Labs/EchoWave.git
Set-Location .\EchoWave
```

也可以解压 Release Server ZIP；此时在解压目录使用包内的 `api.env.example` 和 `compose.yaml`，不要混用源码目录路径。

### 4.2 配置环境和密钥

```powershell
Copy-Item deploy\self-hosted\api.env.example deploy\self-hosted\api.env
New-Item -ItemType Directory -Force deploy\self-hosted\.data\secrets | Out-Null
Copy-Item deploy\self-hosted\credentials.yaml.example `
  deploy\self-hosted\.data\secrets\credentials.yaml
```

生成三个独立随机值：

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

把三个输出分别写入 `POSTGRES_PASSWORD`、`CREDENTIAL_MASTER_KEY` 和 `CONFIGURATION_ADMIN_TOKEN`。如果使用 Local Credential，编辑 YAML 后限制文件只允许当前用户读取；以下命令需要以能够修改 ACL 的 PowerShell 运行：

```powershell
$credentialFile = 'deploy\self-hosted\.data\secrets\credentials.yaml'
$currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
icacls $credentialFile /inheritance:r
icacls $credentialFile /grant:r "${currentIdentity}:(R)"
```

### 4.3 构建、启动和验证

```powershell
docker compose config
docker compose build --no-cache
docker compose up -d --no-build
docker compose ps -a
Invoke-RestMethod http://localhost:3001/health
Invoke-RestMethod http://localhost:3001/api/hello
```

需要国内镜像时，只给当前 PowerShell 会话设置构建参数：

```powershell
$env:NPM_REGISTRY = 'https://registry.npmmirror.com'
$env:DEBIAN_MIRROR = 'http://mirrors.cloud.tencent.com/debian'
$env:DEBIAN_SECURITY_MIRROR = 'http://mirrors.cloud.tencent.com/debian-security'
docker compose build --no-cache
Remove-Item Env:NPM_REGISTRY,Env:DEBIAN_MIRROR,Env:DEBIAN_SECURITY_MIRROR
```

通过 `ipconfig` 找到物理网卡的局域网 IPv4 地址。若手机需要连接，管理员 PowerShell 可以创建仅 Private profile、仅本地子网的规则：

```powershell
New-NetFirewallRule `
  -DisplayName 'EchoWave API (Private LAN)' `
  -Direction Inbound `
  -Action Allow `
  -Protocol TCP `
  -LocalPort 3001 `
  -Profile Private `
  -RemoteAddress LocalSubnet
```

先在手机浏览器访问：

```text
http://<SERVER_LAN_IP>:3001/health
```

再在 EchoWave 中填写 `http://<SERVER_LAN_IP>:3001`。HTTP 只允许用于可信私有地址、localhost、链路本地地址或 `.local`；公网地址必须使用 HTTPS。停止使用局域网访问时应删除对应防火墙规则：

```powershell
Remove-NetFirewallRule -DisplayName 'EchoWave API (Private LAN)'
```

## 5. 配置 AI 连接并启用模式

1. 打开“更多 → AI 配置”，输入 `CONFIGURATION_ADMIN_TOKEN` 进入配置中心。
2. 创建 DashScope 连接；所有模式都需要它完成 Qwen Embedding、文件转写和声学情绪。
3. 创建 DeepSeek 逻辑连接；知识问答、角色、说话人复核和业务分析使用它。可以连接 DeepSeek 官方 API，也可以连接阿里云百炼的 DeepSeek OpenAI-compatible endpoint。
4. 混合或对象存储模式还要创建阿里云 OSS 连接；轻量本地模式可以不配置 OSS。
5. 检查“能力绑定”中的默认模型与连接，再打开“更多 → 运行模式”选择模式并保存。

配置页允许编辑模型名并不表示任意模型都已经适配；优先保留当前默认值。模型与 Credential 说明见[配置与 Credential 指南](./configuration.md)。

## 6. 更新与备份

### 6.1 更新前备份

在当前安装目录创建 PostgreSQL custom-format 备份，避免 Shell 重定向破坏二进制格式：

```bash
mkdir -p backups
docker compose exec -T postgres sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump --format=custom --no-owner --no-acl -U "$POSTGRES_USER" "$POSTGRES_DB" --file=/tmp/echowave-backup.dump'
docker compose cp postgres:/tmp/echowave-backup.dump backups/echowave-before-update.dump
docker compose exec -T postgres rm -f /tmp/echowave-backup.dump
test -s backups/echowave-before-update.dump
```

PowerShell 使用 `New-Item -ItemType Directory -Force .\backups` 创建目录，并以 `(Get-Item .\backups\echowave-before-update.dump).Length` 确认文件非空。备份包含业务数据和加密后的 Database Credential，必须与原 `CREDENTIAL_MASTER_KEY` 一起安全保存。

### 6.2 更新 Release Server

Release 用户按[发布指南](./releases.md)下载、校验和替换 Server ZIP。保留当前 `api.env`、`.data/secrets`、`backups` 和持久卷，然后运行：

```bash
docker compose config
docker compose pull
docker compose up -d
docker compose ps -a
```

### 6.3 更新源码部署

先确认没有未处理的源码修改：

```bash
git status --short
git pull --ff-only origin main
```

比较新版 `deploy/self-hosted/api.env.example` 和现有 `deploy/self-hosted/api.env`，补充缺少的键。不要再次执行复制模板的命令，否则会覆盖数据库密码、Master Key 和管理员令牌。

Linux 可以列出 example 中新增但当前配置缺少的键：

```bash
comm -23 \
  <(grep -E '^[A-Z0-9_]+=' deploy/self-hosted/api.env.example | cut -d= -f1 | sort) \
  <(grep -E '^[A-Z0-9_]+=' deploy/self-hosted/api.env | cut -d= -f1 | sort)
```

PowerShell：

```powershell
$exampleKeys = Get-Content deploy\self-hosted\api.env.example |
  Where-Object { $_ -match '^[A-Z0-9_]+=' } |
  ForEach-Object { ($_ -split '=', 2)[0] }
$currentKeys = Get-Content deploy\self-hosted\api.env |
  Where-Object { $_ -match '^[A-Z0-9_]+=' } |
  ForEach-Object { ($_ -split '=', 2)[0] }
$exampleKeys | Where-Object { $_ -notin $currentKeys }
```

同步检查 `credentials.yaml.example` 的结构，但不要覆盖实际 Credential。完成后重新构建：

```bash
docker compose config
docker compose up -d --build
docker compose ps -a
curl http://127.0.0.1:3001/health
```

通过反向代理部署时，再用公网 HTTPS 地址检查 `/health` 和 `/api/settings/transport-security`。

> [!WARNING]
> 普通更新不得运行 `docker compose down -v`、`docker system prune --volumes` 或删除 `deploy/self-hosted/.data`。这些操作可能删除 PostgreSQL、音频或密钥数据。

## 7. 停用与卸载

### 暂停服务并保留数据

```bash
docker compose down
```

这会删除容器和 Compose 网络，但保留 PostgreSQL/音频 volume、配置和 Credential。以后可以使用 `docker compose up -d` 恢复。

### 完全卸载并删除数据

> [!CAUTION]
> 下列操作会不可逆地删除 EchoWave 的 PostgreSQL 和音频 volume。先验证备份存在、非空且能够安全保留，再确认当前目录确实属于目标 EchoWave 实例。

```bash
docker compose down -v --rmi local --remove-orphans
```

随后只删除该实例自己的 Nginx site、证书和安装目录。Certbot 管理的证书使用 `certbot delete --cert-name <CERT_NAME>`，不要直接删除其内部目录。不要卸载共享的 Docker、Nginx、FFmpeg，也不要执行全局 `docker system prune -a --volumes`。

## 8. 常见排障

### API 或 migration 失败

```bash
docker compose ps -a
docker compose logs migrate
docker compose logs --tail=100 api
docker compose logs -f api
```

保留日志、配置和备份后再判断是修复当前版本还是回退。日志中不得包含真实 Credential、音频正文或未脱敏供应商响应。

### 手机无法连接

- 本机先检查 `/health`。
- 局域网手机不能使用服务器的 `localhost` 或 `127.0.0.1`。
- Windows 检查网络 profile 是否为 Private，以及防火墙规则是否仅允许 LocalSubnet。
- 云服务器检查 443、证书、Nginx 和最小化安全组来源；不要临时开放 3001 作为长期修复。

## 附录 A：受限网络下通过 Windows v2rayN 建立临时反向代理

该方案只用于云服务器无法访问 GitHub、Docker Hub、npm 或 Debian 源时的临时构建排障。Windows 必须已经运行 v2rayN，并确认本地混合监听端口，例如 `10808`。不要把反向代理绑定到公网接口。

Windows PowerShell 先测试代理：

```powershell
Get-NetTCPConnection -LocalPort 10808 -ErrorAction SilentlyContinue
curl.exe -x http://127.0.0.1:10808 -I https://github.com
```

建立只监听云服务器回环地址的 SSH 反向隧道：

```powershell
ssh -NT `
  -o ExitOnForwardFailure=yes `
  -o ServerAliveInterval=30 `
  -R 127.0.0.1:18080:127.0.0.1:10808 `
  <SSH_USER>@<SERVER_IP>
```

该 PowerShell 窗口保持运行。服务器重启、SSH 断开或关闭窗口后，隧道都会消失，需要重新建立。

Ubuntu 另开 SSH 会话验证：

```bash
ss -lnt | grep 18080
curl -x http://127.0.0.1:18080 -I --connect-timeout 15 https://github.com
```

只让当前 Shell 临时走代理：

```bash
export HTTP_PROXY=http://127.0.0.1:18080
export HTTPS_PROXY=http://127.0.0.1:18080
export http_proxy=http://127.0.0.1:18080
export https_proxy=http://127.0.0.1:18080
```

这些变量不会自动配置 Docker daemon。Docker 拉取镜像仍失败时，单独创建 `/etc/systemd/system/docker.service.d/echowave-proxy.conf`：

```ini
[Service]
Environment="HTTP_PROXY=http://127.0.0.1:18080"
Environment="HTTPS_PROXY=http://127.0.0.1:18080"
Environment="NO_PROXY=localhost,127.0.0.1,::1"
```

```bash
sudo systemctl daemon-reload
sudo systemctl restart docker
sudo systemctl show docker --property=Environment
docker pull hello-world
```

### 断线或服务器重启后的恢复顺序

1. 确认 Windows 上 v2rayN 已启动，并再次用 `curl.exe -x` 验证本地端口。
2. 重新运行 `ssh -NT -R 127.0.0.1:18080:127.0.0.1:10808 ...`，保持窗口运行。
3. 在 Ubuntu 上重新运行 `ss` 和代理 `curl` 检查。
4. 若只使用 Shell 代理，重新 `export` 四个代理变量；若保留了 Docker daemon 配置，运行 `sudo systemctl restart docker` 后再测试拉取。
5. 回到 `/opt/echowave`，从失败的 `git`、`docker compose build` 或 `docker compose pull` 步骤继续，不需要重建数据库。

构建完成后恢复环境：

```bash
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY
sudo rm -f /etc/systemd/system/docker.service.d/echowave-proxy.conf
sudo systemctl daemon-reload
sudo systemctl restart docker
```

最后在 Windows 隧道窗口按 `Ctrl+C`。整个方案只在服务器 `127.0.0.1:18080` 上监听，不应产生可从公网访问的代理。
