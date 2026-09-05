# EchoWave 自托管与自行构建

EchoWave 的开源版本支持两条路径：安装维护者发布的 Android APK 并连接自己的服务器，或从源码运行并创建自己的 Expo/EAS 应用。当前版本没有真实用户鉴权，只适合可信局域网；不要把端口直接转发到公网。

## 预构建 APK + Docker Server

### 1. 准备服务配置

安装 Docker Desktop 或 Docker Engine，然后在仓库根目录复制模板：

```powershell
Copy-Item deploy/self-hosted/api.env.example deploy/self-hosted/api.env
```

Linux/macOS：

```bash
cp deploy/self-hosted/api.env.example deploy/self-hosted/api.env
```

编辑 `deploy/self-hosted/api.env`，至少替换以下三项：

- `POSTGRES_PASSWORD`：数据库随机密码。
- `CREDENTIAL_MASTER_KEY`：严格 32 个随机字节的标准 Base64。
- `CONFIGURATION_ADMIN_TOKEN`：至少 32 个随机字符，且不要与数据库密码相同。

PowerShell 可以生成前两类随机值：

```powershell
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
[Convert]::ToBase64String($bytes)
[Convert]::ToHexString($bytes)
```

`api.env` 已被 Git 忽略。不要提交它，也不要把 Firebase/Expo 服务账号密钥放进该文件。若要使用服务器本地 Credential Provider，在 `deploy/self-hosted/.data/secrets/credentials.yaml` 创建只读配置。

### 2. 启动和检查

```powershell
docker compose up -d --build
docker compose ps
```

Compose 会先等待 PostgreSQL/pgvector，通过一次性容器执行全部 migration，再启动 API。以下请求应返回 EchoWave 服务身份：

```powershell
Invoke-RestMethod http://localhost:3001/health
Invoke-RestMethod http://localhost:3001/api/hello
```

手机不能使用电脑的 `localhost`。通过 `ipconfig`、`ip addr` 或路由器管理页找到服务器局域网地址，例如 `http://192.168.1.7:3001`；确认防火墙允许可信局域网访问 TCP 3001，推荐在路由器中为服务器配置 DHCP Reservation。

### 3. 连接 Android App

从 GitHub Releases 安装 `EchoWave-<version>.apk`。首次打开时输入局域网服务器根地址，依次选择“测试连接”和“保存并继续”。HTTP 只允许本机或私有局域网地址；公网服务必须配置 HTTPS。

Self-hosted V1 使用 SSE 和应用内状态，不请求 Android 推送权限，也不向服务器注册官方 Expo 项目的 Push Token。PostgreSQL 与音频数据保存在 Docker volumes 中；升级或重启不会删除它们。备份、恢复或删除 volume 前先停止服务并确认目标。

## 从源码开发

安装 Node.js 24 与仓库固定的 pnpm 11.3.0，复制 API 和移动端环境模板并完成配置，然后安装依赖：

```powershell
corepack enable
pnpm install --frozen-lockfile
pnpm dev:api
```

另开终端选择运行方式：

```powershell
# 默认：已安装在设备上的 EchoWave Development Build
pnpm dev:mobile

# 可选：只测试 Expo Go 支持的功能；远程推送不可用
pnpm --filter @echowave/mobile dev:go -- --lan
```

普通 TS/TSX 修改通过 Fast Refresh 生效。安装原生依赖、升级 Expo SDK、修改权限、Firebase 或通知配置后必须重新创建 Development Build。

## 创建自己的 EAS/Firebase 应用

自行分发前，不得继续冒用维护者的应用身份或凭据。请依次替换 Expo owner/projectId/slug、Android package、iOS bundle identifier、应用签名和 Firebase Android 应用：

```powershell
Set-Location apps/mobile
pnpm dlx eas-cli@latest login
pnpm dlx eas-cli@latest init
pnpm dlx eas-cli@latest build --platform android --profile development
```

若要启用远程推送，还需下载自己 Firebase 应用的 `google-services.json`，放入 `apps/mobile`，并通过 `eas credentials` 上传自己的 FCM v1 服务账号密钥。此仓库默认忽略 `google-services.json`；使用 EAS 云端构建时，应分别把它上传为 Development 与 Production 环境中的 `GOOGLE_SERVICES_JSON` Secret 文件变量。服务端 `PUSH_NOTIFICATIONS_ENABLED=true` 只应在客户端、EAS 项目和 Firebase 凭据都归自己控制时使用。

构建档位：

- `development`：含开发菜单的内部安装 APK。
- `production-apk`：不含开发工具的签名 APK，可手动上传 GitHub Releases；强制首次手动选择服务器。
- `production`：Google Play 默认 AAB 或 iOS 商店归档；同样忽略开发默认服务器。

仓库当前三个档位都沿用 `com.echowave.app`，因此 Development、GitHub APK 和商店版会互相覆盖，不能在同一设备并存。若贡献者需要并行安装，应先改成自己拥有的包标识并创建对应 Firebase 应用。

本仓库暂不自动创建 GitHub Release，也不包含二维码发现、mDNS、官方 Push Relay、手机内置后端或完全离线 AI 模型。
