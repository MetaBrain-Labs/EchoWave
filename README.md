# EchoWave

EchoWave 是一个面向音频分析、知识库关联和数据源连接场景的跨平台应用。当前里程碑提供 Expo 三端界面、Node.js API、基于 PostgreSQL/pgvector 的首期 RAG 知识库，以及通过 OpenRouter Gemini 完成的版本化音频 ASR；仍不包含真实鉴权。

## 技术基线

- Node.js 24
- pnpm 11.3.0
- Turborepo
- Expo SDK 57、React Native 0.86、React 19
- Hono、Zod、TypeScript、LangChain、LangGraph、DeepAgents
- PostgreSQL 15+、pgvector 0.8.0+

## 仓库结构

```text
apps/
  api/
    src/
      bootstrap/       服务启动、运行时装配与显式迁移入口
      ai-observability/ AI 执行报告与安全诊断记录
      config/          环境配置解析
      infrastructure/ PostgreSQL 连接设施
      http/            Hono 应用与传输层错误映射
      knowledge/       知识库领域深模块（回答、嵌入、入库、持久化）
  mobile/
    src/
      app/              Expo Router 薄路由
      shared/           API 基础、Hook、导航、主题与通用 UI
      features/         analysis-detail、group、knowledge、system-status
packages/
  contracts/
    src/                通用错误、知识库、文档与 RAG 网络契约
docs/
  README.md            文档索引
  architecture.md      架构与技术决策
  database-schema.md   数据库表、关系与生命周期
  design-system.md     移动端设计规范
  domain-language.md   领域术语
```

模块职责和依赖方向详见 [架构说明](./docs/architecture.md)，数据库表与关系详见 [数据库结构](./docs/database-schema.md)，领域名词以 [领域语言](./docs/domain-language.md) 为准。

## 本地启动

### 1. 准备工具链

确认当前使用 Node.js 24 和 pnpm 11.3.0：

```powershell
node --version
pnpm --version
```

如果尚未安装 pnpm，请先按 [pnpm 官方安装说明](https://pnpm.io/installation)安装 11.3.0。本仓库日常命令直接使用 `pnpm`，不要求通过 Corepack 调用。

### 2. 安装依赖

```powershell
pnpm install
```

根目录 `packageManager` 和 `pnpm-lock.yaml` 会共同保证可重复安装。

### 3. 配置环境变量

首次运行时，从示例创建两个本地配置文件：

```powershell
Copy-Item apps/api/.env.example apps/api/.env
Copy-Item apps/mobile/.env.example apps/mobile/.env
```

`apps/api/.env` 中的 `AUDIO_STORAGE_DIR` 是手动上传音频的持久化目录。该目录应位于具备持久化磁盘的服务端路径，API 只把随机生成的相对 `storage_key` 写入数据库。生产或容器环境必须显式挂载并备份该目录；不要把它指向临时目录或纳入 Git。

FFmpeg 是可选的音频转写预处理能力。配置 `FFMPEG_PATH` 后，API 启动时会非致命探测可执行文件；缺失或检查失败不会阻止 API 启动，短期开发可在转写确认框取消 FFmpeg 并将原音频直接发送给 OpenRouter。启用时，临时 MP3 分块写入 `AUDIO_TRANSCRIPTION_TEMP_DIR`。模型固定为 `google/gemini-2.5-flash-lite`，密钥复用 `OPENROUTER_API_KEY`。

原音频直传支持 MP3、WAV、M4A、AAC、FLAC、OGG 和 WebM，并沿用 200 MB 上传上限；base64 会使请求体增大约三分之一，提供商可能拒绝大文件。此时应重新转写并勾选 FFmpeg，不会自动回退或覆盖旧结果。

`apps/api/.env` 是 API 的唯一配置来源：启动时会直接读取并校验该文件，不合并系统环境变量，也不使用隐式默认值。移动端由 Expo CLI 自动加载 `apps/mobile/.env`，其中客户端可用变量必须以 `EXPO_PUBLIC_` 开头：

```dotenv
EXPO_PUBLIC_API_URL=http://localhost:3001
```

`EXPO_PUBLIC_*` 会被写入客户端 bundle，不得放置密码、令牌或其他秘密。修改该文件后，需要在 Expo Go 中执行完整 Reload 才能确认新值已生效。详见 [Expo 环境变量文档](https://docs.expo.dev/guides/environment-variables/)。

API 的 PostgreSQL 配置使用 `POSTGRES_HOST`、`POSTGRES_PORT`、`POSTGRES_USER` 等分字段变量。RAG 还要求 OpenRouter、DeepSeek、固定开发租户与临时上传目录配置，字段清单见 `apps/api/.env.example`。Redis 字段仍仅作未来边界预留。

### 可选 AI 执行报告

知识问答、文档入库和音频 ASR 支持本地 Markdown 执行摘要。它用于开发与测试诊断，不是单元测试覆盖率或 CI 测试结果。报告默认关闭；需要时在 `apps/api/.env` 设置：

```dotenv
AI_EXECUTION_REPORT_ENABLED="true"
AI_EXECUTION_REPORT_OUTPUT_DIR=".ai-execution-reports"
AI_EXECUTION_REPORT_CONTEXT_ENABLED="false"
AI_EXECUTION_REPORT_TOOL_CONTENT_ENABLED="false"
AI_EXECUTION_REPORT_OUTPUT_ENABLED="false"
AI_EXECUTION_REPORT_REASONING_ENABLED="false"
```

每个被 worker 领取的转写修订生成一份 `audio-transcription` 报告，记录安全的数据源/音频快照、direct 或 FFmpeg 预处理、分块时间边界、每次 OpenRouter 网络与结构纠正尝试、Token/音频 Token/费用、校验合并、发布、清理和失败持久化。报告不会记录连接地址、`connection_label`、`storage_key`、外部来源 ID、文件路径、音频、base64、提示词、密钥或 Provider 原始错误包。

`AI_EXECUTION_REPORT_OUTPUT_ENABLED="false"` 是安全默认值：关闭时失败输出只记录长度、SHA-256 和结构化问题；开启时仅允许 ASR 的失败模型输出进入本地报告，每次最多 20,000 字符、单修订最多 40,000 字符并标记截断。成功转写正文始终不写入报告，失败正文也不会进入 PostgreSQL、HTTP API 或移动端。报告目录已被 Git 忽略且不会自动清理，避免后台任务误删诊断证据。

首次启动前显式执行迁移；普通 API 启动不会修改数据库 schema：

```powershell
pnpm --filter @echowave/api migrate
```

如需在本地还原移动端音频工作区演示内容，请在迁移完成后执行幂等开发 seed：

```powershell
pnpm --filter @echowave/api seed:dev
```

开发 seed 使用固定演示 UUID，可安全重复执行；它不会写入 migration，也不保存音频二进制或连接凭据。

迁移会创建业务 schema、`vector(1024)` HNSW 索引、固定开发租户和独立 LangGraph checkpoint schema。PostgreSQL 必须已经安装 `vector` 扩展。

如果 API 报告端口已被占用，说明已有另一个服务实例监听了 `apps/api/.env` 中的 `PORT`。停止旧实例，或修改该 `PORT`，并同步更新 `apps/mobile/.env` 中 URL 的端口。

不同运行环境需要使用不同主机地址：

- Web、iOS Simulator：`http://localhost:<API_PORT>`
- Android Emulator：通常为 `http://10.0.2.2:<API_PORT>`
- Android/iOS 真机：使用开发电脑的局域网地址，例如 `http://192.168.1.20:<API_PORT>`

这里的 `<API_PORT>` 必须等于 `apps/api/.env` 中的 `PORT`。真机与开发电脑需要处于同一网络，且本机防火墙需要允许 Node.js 和该 API 端口通过专用网络。若 Expo Web 使用了非 8081 端口，请同步修改 API 的 `CORS_ORIGINS`。

### 4. 启动

同时启动 Expo 与 API：

```powershell
pnpm start
```

该命令使用 Turborepo 的交互式终端界面。选择 `@echowave/mobile#dev` 任务即可查看 Expo 的二维码、`exp://` 地址和快捷键；按 `Enter` 可进入该任务并向 Expo 发送按键。

也可以分开启动，便于操作 Expo 的交互式终端：

```powershell
pnpm dev:api
pnpm dev:mobile
```

进入 Expo 终端后，按 `w` 打开 Web，按 `a` 打开 Android。iOS Simulator 需要在 macOS 上运行。

## 使用 Expo Go 在真机测试

### SDK 兼容性

本项目使用 Expo SDK 57。Expo Go 从 SDK 51 起一次只支持一个 SDK 版本，因此手机上的 Expo Go 必须与项目 SDK 匹配。**截至 2026-08-15，Expo 官方下载页仍将 SDK 56 标为最新 Expo Go，SDK 57 官方建项文档也提示过渡期内实体机 Expo Go 受限。商店版 Expo Go 因此不能被视为当前项目的可靠测试运行时。**开始测试前请在 [Expo Go 下载页](https://expo.dev/go)重新确认 SDK 57 是否已经可用；如果手机提示 SDK 不兼容，这不是二维码或网络故障。

Android 在官方提供匹配版本后可以安装指定版本的 Expo Go；实体 iOS 受 App Store 分发限制，只能使用当时可分发的版本。项目后续加入 Expo Go 未内置的原生模块时，也必须改用 Development Build。参见 [Expo Go 的能力边界](https://docs.expo.dev/faq/#what-can-i-do-or-cannot-do-with-expo-go)和 [SDK 57 过渡期说明](https://docs.expo.dev/get-started/create-a-project/)。

### 连接步骤

以下步骤适用于手机已经安装了与 SDK 57 匹配的 Expo Go：

1. 让手机和电脑连接同一个可信 Wi-Fi。在 PowerShell 运行 `ipconfig`，找到当前 Wi-Fi 或以太网适配器的 IPv4 地址，例如 `192.168.1.20`。
2. 确认 `apps/api/.env` 中的 `PORT`，然后把 `apps/mobile/.env` 配置为电脑的局域网地址。例如 API 端口为 `3201`：

   ```dotenv
   EXPO_PUBLIC_API_URL=http://192.168.1.20:3201
   ```

3. 在第一个终端启动 API：

   ```powershell
   pnpm dev:api
   ```

4. 可先用手机浏览器访问 `http://192.168.1.20:3201/api/hello`。能看到 `HelloWorld` 响应，才说明手机能够访问 API；否则检查 IP、端口、同网段状态、路由器的客户端隔离设置和 Windows 防火墙。
5. 在第二个终端明确以 Expo Go + LAN 模式启动移动端：

   ```powershell
   pnpm --filter @echowave/mobile exec expo start --go --lan
   ```

6. Android 在 Expo Go 中选择“Scan QR code”；iPhone 使用系统相机扫描。打开 EchoWave 后进入“更多”页，确认 API 状态为在线且消息为 `HelloWorld`。

Expo 官方建议真机和电脑处于同一 Wi-Fi；若只有 Metro 无法连接，可以将上一步的 `--lan` 改为 `--tunnel`。Tunnel 会明显变慢，而且**只代理 Expo/Metro，不会代理 EchoWave API**，所以 `EXPO_PUBLIC_API_URL` 指向的 API 仍需能被手机访问。详见 [Expo 真机启动与网络排查](https://docs.expo.dev/get-started/start-developing/)。

### 常见问题

- 没有二维码：不要从仓库根目录运行 `npx expo start`；使用上面的 workspace 命令，或运行 `pnpm start` 后在 Turbo TUI 中选择 `@echowave/mobile#dev`。
- 扫码后提示 SDK 不兼容：安装匹配 SDK 57 的 Expo Go；如果官方尚未提供，则等待匹配版本或为项目配置 Development Build，不要把它当作网络问题排查。
- 手机能打开应用但 API 离线：检查 `apps/mobile/.env` 是否仍写着 `localhost`，并确认它的端口与 `apps/api/.env` 完全一致。
- 修改 `.env` 后未生效：在 Expo Go 中执行完整 Reload；必要时停止 Metro 后加 `--clear` 重新启动。
- 公共 Wi-Fi 或访客网络无法连接：优先换用允许设备互访的私人网络或手机热点；仅切换 Metro Tunnel 不能解决自定义 API 不可达的问题。

## 可用脚本

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm check
```

`build` 会编译共享契约与 Node API，并通过 Expo 为 iOS、Android、Web 生成可移植的 JavaScript bundle。该校验命令跳过 Hermes bytecode；正式原生构建仍由未来的 EAS/原生流水线负责。生成目录和本地缓存不会提交到 Git。

## 当前功能

- 分组主界面的目录切换、创建与归档，以及音频分析、关联知识库和连接数据源标签
- 分组内跨标签搜索、音频创建时间排序与多状态筛选
- 音频完成、跨分组、待分析、上传中、分析中状态示例
- 分组、知识库、新建、分析、更多五项导航
- Markdown、DOCX、XLSX 单文件上传、异步解析、分块、嵌入与状态轮询
- PostgreSQL 租户隔离、revision 原子发布、HNSW 检索和引用回溯
- PostgreSQL 数据源创建、编辑、软归档、分组关联/解除，以及本地批量音频上传与软归档
- PostgreSQL 音频上传时间线和版本化分析结果查询纵切片
- 数据源音频的后台 ASR、Speaker 分离、业务角色、情绪与毫秒时间戳结构化结果
- DeepSeek + DeepAgents 知识问答、无证据拒答与短会话 checkpoint
- 可选的知识问答与入库 Markdown 执行诊断报告
- 移动端知识库列表、文档/块详情、上传、动态问答反馈、最近六轮只读历史和可返回聊天的引用跳转
- 更多页中的 API 加载、在线、离线、超时和重试状态
- `GET /api/hello` HelloWorld 接口及共享 Zod 契约

## 当前边界

本里程碑不包含真实鉴权、转写后的二阶段摘要/标签分析、数据源同步、Redis、对象存储、OCR、PDF、旧版 Office、多 API 实例部署或 EAS Build。手动上传音频保存在 `AUDIO_STORAGE_DIR` 指定的单机持久化目录；知识入库与音频转写 worker 均与 API 同进程，本地文件模式仅支持单 API 实例，横向扩容前必须迁移到对象存储和独立 worker。详见 [文档索引](./docs/README.md) 与 [架构说明](./docs/architecture.md)。

在 Windows 上无法运行 iOS Simulator；iOS 本轮通过 Expo bundle 导出、TypeScript 检查和应用配置校验，最终原生运行验收需在 macOS/Xcode 环境完成。
