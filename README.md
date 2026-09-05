# EchoWave

EchoWave 是一个面向音频分析、知识库检索和数据源管理的跨平台应用。仓库当前提供 Expo Android/iOS/Web 客户端、Node.js API、PostgreSQL/pgvector RAG、版本化音频转写与分析，以及可在可信局域网部署的 Docker Self-hosted Server。

当前版本仍使用固定开发租户，没有真实账号、鉴权和公网部署所需的完整安全边界。仓库尚未发布可供普通用户下载的正式 APK；GitHub Releases + Self-hosted Server 是正式 APK 发布后的使用路径。

## 技术基线

- Node.js 24、pnpm 11.3.0、Turborepo
- Expo SDK 57、React Native 0.86、React 19
- Hono、Zod、TypeScript、LangGraph/DeepAgents
- PostgreSQL 15+、pgvector 0.8.0+
- FFmpeg、Silero VAD、DashScope、DeepSeek

## 仓库结构

```text
apps/api/                 Node.js API、领域服务、Worker 与 SQL migrations
apps/mobile/              Expo Router 移动端与 Web 客户端
packages/contracts/       API 与 App 共用的 Zod 网络契约
deploy/self-hosted/       Docker Self-hosted 配置模板
docs/                     架构、数据库、配置、运行模式与构建指南
scripts/check-docs.mjs    文档结构和关键入口校验
compose.yaml              PostgreSQL、migration 与 API 服务
```

完整主题入口见[文档索引](./docs/README.md)和[文档导览](./docs/documentation-guide.md)。

## 本地开发

### 1. 安装与配置

确认使用仓库要求的工具链：

```powershell
node --version
pnpm --version
pnpm install
```

首次运行时创建未跟踪的本地配置：

```powershell
Copy-Item apps/api/.env.example apps/api/.env
Copy-Item apps/mobile/.env.example apps/mobile/.env
```

至少完成 PostgreSQL、`CREDENTIAL_MASTER_KEY`、`CONFIGURATION_ADMIN_TOKEN`、`LOCAL_CREDENTIALS_FILE` 和目录配置。供应商连接、能力绑定与 Credential 边界见[配置与 Credential 指南](./docs/configuration.md)。物理手机不能通过 `localhost` 访问电脑；`apps/mobile/.env` 应使用电脑的局域网地址并与 API 端口一致：

```dotenv
EXPO_PUBLIC_API_URL=http://<SERVER_LAN_IP>:<API_PORT>
```

首次启动前显式执行 migration；需要演示数据时再运行幂等 seed：

```powershell
pnpm --filter @echowave/api migrate
pnpm --filter @echowave/api seed:dev
```

### 2. 启动 API 与客户端

可通过 Turbo TUI 一次启动 API 与使用 LAN 模式的 Development Build 客户端：

```powershell
pnpm start
```

也可在两个终端分别运行：

```powershell
pnpm dev:api
```

```powershell
pnpm dev:mobile -- --lan
```

Metro 报告缓存无法反序列化时，停止旧进程后清缓存启动：

```powershell
pnpm dev:mobile -- --lan --clear
```

不同客户端使用的 API 主机通常为：

- Web、iOS Simulator：`http://localhost:<API_PORT>`
- Android Emulator：`http://10.0.2.2:<API_PORT>`
- Android/iOS 真机：`http://<SERVER_LAN_IP>:<API_PORT>`

## Development Build 与 Expo Go

Development Build 是默认原生开发环境，支持项目自己的原生依赖、Firebase 和远程推送。当前官方 EAS 项目已经绑定；维护者必须在 `apps/mobile` 中执行 EAS 命令，不要在仓库根目录重新运行 `eas init`：

```powershell
Set-Location apps/mobile
pnpm dlx eas-cli@latest login
pnpm dlx eas-cli@latest build --platform android --profile development
```

普通 TS/TSX 修改通过 Metro/Fast Refresh 生效。升级 Expo SDK、添加或升级原生依赖、修改原生权限、Firebase 或通知配置后，需要重新构建 Development APK。

Expo Go 只用于不依赖远程推送的兼容功能预览：

```powershell
pnpm --filter @echowave/mobile dev:go -- --lan
```

Android Expo Go 从 SDK 53 起不提供远程推送能力，EchoWave 会在该运行时安全跳过通知模块。完整的 Firebase/EAS 设置、Push 验收和 Production APK 流程见[自托管与自行构建](./docs/self-hosting.md)。

## 运行时服务器连接

App 将通过健康检查验证的服务器根地址保存到 AsyncStorage，所有 REST、上传、SSE、音频和通知注册请求都在调用时读取该地址。已保存地址优先于 Development/Expo Go 的 `EXPO_PUBLIC_API_URL` 默认值。

`production-apk` 与 `production` profile 强制忽略开发默认地址。清除应用数据后的 Production Build 首次只显示“连接到 EchoWave Server”，通过 `GET /health` 后才能保存并进入主应用。“更多 → 服务状态”可以修改服务器并重新挂载业务导航。

客户端只允许 HTTP 指向 localhost、私有/链路本地地址或 `.local` 主机；公网服务器必须使用 HTTPS。`GET /health` 的 `capabilities.remotePush` 决定 App 是否请求通知权限并注册设备。

## Self-hosted

当前可从源码运行 Self-hosted Server：

```powershell
Copy-Item deploy/self-hosted/api.env.example deploy/self-hosted/api.env
docker compose config
docker compose up -d --build
```

模板默认关闭远程推送，使用 PostgreSQL/pgvector、SSE 和应用内状态。正式 Release APK 发布后，普通用户可以安装 APK 并连接自己的局域网服务器。配置生成、持久卷、端口、防火墙和安全限制见[自托管与自行构建](./docs/self-hosting.md)。

当前 API 没有真实用户鉴权，不得直接暴露到公网。

## 常用命令

```powershell
pnpm docs:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm check
```

`pnpm build` 编译共享契约与 API，并为 Android、iOS、Web 导出 Expo bundle；它不会生成可安装 APK。原生包使用 `apps/mobile/eas.json` 中的 `development`、`production-apk` 和 `production` profiles。仓库当前不自动创建 GitHub Release。

## 当前能力与边界

当前已经实现：

- 分组、知识库、数据源、音频上传和软归档的 PostgreSQL 纵切片
- 文档解析、pgvector 检索、可信引用问答和短历史
- DashScope 版本化 ASR、Confirmed Transcript、说话人复核、情绪与角色分析
- LangGraph 销售复盘、批次自动化、恢复/取消、SSE 状态与可选原生推送
- AI 供应商配置、Credential revision、能力绑定与安全执行审计
- Development/Production EAS profiles、运行时服务器选择和 Docker Self-hosted 模板

当前不包含真实鉴权、数据源自动同步、OCR/PDF/旧版 Office、Redis 实现、独立 Worker 部署、自动 Release、二维码/mDNS 发现、官方云服务或手机内置离线后端。API 与 Worker 仍在同一进程；本地音频路径和进程内 SSE 唤醒要求单 API 实例。iOS 原生运行与推送验收需要 macOS/Xcode 和 Apple/APNs 凭据。

专题说明：

- [架构说明](./docs/architecture.md)
- [数据库结构](./docs/database-schema.md)
- [配置与 Credential](./docs/configuration.md)
- [音频运行模式](./docs/audio-runtime-modes.md)
- [一键式音频全流程分析](./docs/audio-analysis-automation.md)
- [自托管与自行构建](./docs/self-hosting.md)
- [设计规范](./docs/design-system.md)
- [领域语言](./docs/domain-language.md)
