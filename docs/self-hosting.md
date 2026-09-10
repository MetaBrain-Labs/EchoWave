# EchoWave 自托管与自行构建

EchoWave 支持两条开源使用路径：稳定 Tag 发布完成后，普通用户从 [GitHub Releases](https://github.com/MetaBrain-Labs/EchoWave/releases) 下载同一版本的签名 Android APK 与 Server ZIP；维护者或 Fork 用户也可以 Clone 源码后创建自己的 Development/Production Build。下载、SHA-256 校验、升级与回退规则见[发布指南](./releases.md)。

当前 API 使用固定开发租户，没有真实用户鉴权，只适合可信局域网。不要直接转发 API 端口到公网；公网部署必须先补齐鉴权、HTTPS、反向代理和运维防护。

## Docker Self-hosted Server

正式 Release 用户应解压 `EchoWave-server-vX.Y.Z.zip`，复制包内 `api.env.example` 为
`api.env`，然后直接运行 `docker compose pull && docker compose up -d`。包内 Compose 已固定
到该版本的 GHCR 镜像 digest，不需要源码和本地镜像构建。下面的根 Compose 流程保留给 Clone
源码开发和自行构建者。

### 1. 准备配置

安装 Docker Desktop 或 Docker Engine，在仓库根目录复制专用模板：

```powershell
Copy-Item deploy/self-hosted/api.env.example deploy/self-hosted/api.env
```

Linux/macOS：

```bash
cp deploy/self-hosted/api.env.example deploy/self-hosted/api.env
```

编辑 `deploy/self-hosted/api.env`，至少替换：

- `POSTGRES_PASSWORD`：数据库随机密码。
- `CREDENTIAL_MASTER_KEY`：严格 32 个随机字节的标准 Base64。
- `CONFIGURATION_ADMIN_TOKEN`：至少 32 个随机字符，且与其他密码相互独立。

PowerShell 示例：

```powershell
$masterKeyBytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Fill($masterKeyBytes)
[Convert]::ToBase64String($masterKeyBytes)

$adminTokenBytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Fill($adminTokenBytes)
[Convert]::ToHexString($adminTokenBytes)
```

`deploy/self-hosted/api.env` 已被 Git 忽略。不要提交该文件、Firebase 服务账号、Keystore 或其他 Credential。

如需 Local Credential Provider，在宿主机创建：

```text
deploy/self-hosted/.data/secrets/credentials.yaml
```

Compose 将该目录只读挂载到容器的 `/app/.data/secrets`，模板中的 `LOCAL_CREDENTIALS_FILE=.data/secrets/credentials.yaml` 因此解析为 `/app/.data/secrets/credentials.yaml`。文件格式与权限要求见[配置与 Credential 指南](./configuration.md)。

### 2. 端口、启动与健康检查

容器内 API 固定监听 3001，Compose 默认也映射到宿主机 3001。需要改变宿主机端口时，在运行 Compose 的终端设置：

```powershell
$env:ECHOWAVE_API_PORT = "3201"
```

然后校验配置并启动：

```powershell
docker compose config
docker compose up -d --build
docker compose ps
```

Compose 会等待 PostgreSQL/pgvector 健康，通过一次性 `migrate` 服务执行所有编号 migration，成功后再启动 API。默认端口的检查命令可以直接运行；若设置了 `ECHOWAVE_API_PORT`，同步替换 URI 中的 3001：

```powershell
Invoke-RestMethod http://localhost:3001/health
Invoke-RestMethod http://localhost:3001/api/hello
```

`/health` 应返回 `name=EchoWave`、`service=echowave-api`、`apiVersion=1`、`status=ok` 和能力字段。`/api/hello` 保持兼容响应 `{ ok: true, service: "echowave-api", message: "HelloWorld" }`。

PostgreSQL 与音频分别保存在 `echowave_postgres` 和 `echowave_audio` volumes；临时上传与转写目录使用容器临时数据。升级或重启不会删除持久卷。备份、恢复或删除 volume 前，应停止服务并确认目标。

### 3. 局域网连接

通过 `ipconfig`、`ip addr` 或路由器管理页查找服务器局域网地址。推荐为服务器设置 DHCP Reservation，并仅在可信专用网络中开放 `<API_PORT>`。

手机中填写：

```text
http://<SERVER_LAN_IP>:<API_PORT>
```

手机不能使用服务器的 `localhost`。先在手机浏览器访问 `/health`，再在 EchoWave 中选择“测试连接”和“保存并继续”。App 只允许 HTTP 指向 localhost、私有/链路本地地址或 `.local` 主机；公网地址必须使用 HTTPS。

Self-hosted 模板设置 `PUSH_NOTIFICATIONS_ENABLED=false`。此时 `/health.capabilities.remotePush=false`，App 不请求通知权限，也不注册 Expo Push Token；批次状态使用 SSE 和应用内状态。

## 从源码开发

安装 Node.js 24 和 pnpm 11.3.0，并在仓库根目录执行：

```powershell
pnpm install --frozen-lockfile
Copy-Item apps/api/.env.example apps/api/.env
Copy-Item apps/mobile/.env.example apps/mobile/.env
pnpm --filter @echowave/api migrate
```

通过 Turbo TUI 一次启动 API 与使用 LAN 模式的 Development Build 客户端：

```powershell
pnpm start
```

也可以在两个终端分别运行：

```powershell
pnpm dev:api
```

```powershell
pnpm dev:mobile -- --lan
```

若 Metro 提示 `Unable to deserialize cloned data`，这是过期或损坏的磁盘缓存。停止旧 Metro 后执行：

```powershell
pnpm dev:mobile -- --lan --clear
```

Development Build 是默认原生开发环境。普通 TS/TSX 修改通过 Fast Refresh 生效；升级 Expo SDK、添加/升级原生依赖、修改权限、Firebase、通知或其他原生配置后必须重新构建。

Expo Go 只用于兼容功能预览，不能验证 Android 远程推送：

```powershell
pnpm --filter @echowave/mobile dev:go -- --lan
```

Metro Tunnel 只代理 Expo/Metro，不会代理 EchoWave API。

## 官方项目的 Android Development Build

官方 EAS 项目已经绑定。维护者只在 `apps/mobile` 中执行 EAS 命令，不要在仓库根目录运行 EAS，也不要再次执行 `eas init`。

`google-services.json` 是 Firebase Android 客户端配置，仓库默认忽略它。把文件放到 `apps/mobile/google-services.json` 后，分别上传为 Development 与 Production 环境的 Secret 文件变量：

```powershell
Set-Location apps/mobile

pnpm dlx eas-cli@latest env:set `
  --environment development `
  --name GOOGLE_SERVICES_JSON `
  --value ./google-services.json `
  --type file `
  --visibility secret `
  --scope project

pnpm dlx eas-cli@latest env:set `
  --environment production `
  --name GOOGLE_SERVICES_JSON `
  --value ./google-services.json `
  --type file `
  --visibility secret `
  --scope project
```

只确认变量名称存在，不读取文件内容：

```powershell
pnpm dlx eas-cli@latest env:list --environment development
pnpm dlx eas-cli@latest env:list --environment production
```

通过以下命令确认 `com.echowave.app` 已关联 Android Keystore 和 FCM v1 Service Account：

```powershell
pnpm dlx eas-cli@latest credentials -p android
```

FCM v1 Service Account 与 `google-services.json` 必须来自同一个 Firebase 项目，否则可能出现 `MismatchSenderId`。服务账号私钥只保存在 EAS Credentials，不提交仓库；`app.config.js` 会在云构建中读取 `GOOGLE_SERVICES_JSON` 文件路径，本地构建则使用工作区中的文件。

创建 Development APK：

```powershell
pnpm dlx eas-cli@latest build --platform android --profile development
```

## Android 推送验收

在用于验收的 `apps/api/.env` 中设置：

```dotenv
PUSH_NOTIFICATIONS_ENABLED="true"
```

重启 API 后，替换下面两个示例值并确认：

```powershell
$serverLanIp = "192.168.1.7"
$apiPort = 3201
Invoke-RestMethod "http://${serverLanIp}:${apiPort}/health"
```

返回值中的 `capabilities.remotePush` 必须为 `true`。安装 Development APK，启动 Metro，并完成：

1. App 连接服务器并请求 Android 通知权限。
2. 打开“更多 → 服务状态”，确认“推送通知”卡片显示“设备已登记”；若显示 Token、API 或权限错误，按错误代码修复后使用“重新登记”。
3. 检查数据库存在启用的 Android `push_devices` 记录；系统权限允许本身不代表远程推送登记成功。
4. 使用 Expo 推送测试工具先验证该构建对应的 Token 可以接收通知。
5. 创建一个分析批次，退出 App，并分别检查 event、delivery、ticket、receipt 与后台系统通知。
6. 点击通知后进入对应的分析批次页面。
7. 检查 API 结构化日志与通知 outbox，确认没有 `InvalidCredentials`、`MismatchSenderId` 或 `DeviceNotRegistered`。

若批次全部复用已有分析，仍应在 `.ai-execution-reports/<日期>` 看到一份 `audio-analysis-batch` 清单，并在其中看到各阶段 `reused`；没有新的单次模型调用报告是预期行为。该目录只用于本地诊断，不是业务状态或用户下载报告的权威存储。

远程推送需要原生 Build，不限于 Development Build。当前仓库只记录 Android/Firebase 验收路径；iOS 需要另行配置 Apple Developer、APNs 凭据，并在 macOS/Xcode 环境完成原生验收。

## Production APK 与商店构建

Development Build 推送通过后可手动生成与自动发布流程相同 profile 的正式 APK：

```powershell
Set-Location apps/mobile
pnpm dlx eas-cli@latest build --platform android --profile production-apk
```

`production-apk` 不包含开发菜单，不能连接 Metro，并通过 `EXPO_PUBLIC_REQUIRE_SERVER_SELECTION=true` 强制首次选择服务器。安装前卸载 Development Build 或清除应用数据；三个 profiles 使用同一个 Android package，不能在同一设备并存，覆盖安装还可能保留 AsyncStorage。

Production APK 验收：

- 清除数据后只显示“连接到 EchoWave Server”。
- 输入局域网服务器，通过 `/health` 后保存并进入主应用。
- `remotePush=false` 时不请求权限、不注册设备。
- 修改服务器后旧 SSE 断开，页面数据重新加载。

Google Play 发布时使用 `production` profile 生成默认 AAB；AAB 不能像 APK 一样直接安装到普通真机。稳定 `vX.Y.Z` Tag 会使用固定 EAS CLI 自动生成签名 APK、Server ZIP、Release manifest 与 SHA-256，并在全部门禁通过后公开 GitHub Release。

## Fork 或自行分发

Fork 用户不得复用维护者的应用身份、Firebase、Keystore 或 FCM Service Account。自行构建前必须替换：

- Expo owner、projectId 和 slug。
- Android package 与 iOS bundle identifier。
- Firebase Android 应用及 `google-services.json`。
- FCM v1、Android 签名和 iOS/APNs 凭据。

身份替换后，在 `apps/mobile` 中登录自己的 Expo 账号并运行 `eas init` 或 `eas build:configure`，再按自己的项目上传环境变量和 Credentials。

## Expo 官方参考

- [EAS 环境变量与 Secret 文件](https://docs.expo.dev/eas/environment-variables/manage/)
- [Android FCM v1 Credentials](https://docs.expo.dev/push-notifications/fcm-credentials/)
- [Development Build 推送设置](https://docs.expo.dev/push-notifications/push-notifications-setup/)
- [Android APK 与商店 AAB](https://docs.expo.dev/build-reference/apk/)
- [清理 Expo/Metro bundler 缓存](https://docs.expo.dev/router/installation/#clear-bundler-cache)
