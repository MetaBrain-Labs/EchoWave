# EchoWave

EchoWave 是一个面向音频分析、知识库关联和数据源连接场景的跨平台应用。当前里程碑提供 Expo 三端界面、Node.js API、基于 PostgreSQL/pgvector 的首期 RAG 知识库，以及通过 DashScope 官方接口完成的版本化音频转写；仍不包含真实鉴权。

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
      bootstrap/       服务启动、领域 runtime/seed 工厂与显式迁移入口
      ai-observability/ AI 执行报告与安全诊断记录
      ai-runtime/      跨领域模型调用与结构化输出基础能力
      config/          分模块配置解析，env.ts 统一装配 .env
      infrastructure/ PostgreSQL 连接设施
      http/            Hono 组合入口、SSE 与领域路由
      knowledge/       知识目录、检索、回答、入库与持久化
      workspace/
        groups/        分组 Service 与 PostgreSQL Repository
        data-sources/  数据源 Service 与 PostgreSQL Repository
        audio/         core、transcription、post-analysis、business-analysis、execution
  mobile/
    src/
      app/              Expo Router 薄路由
      shared/           分资源 API 客户端、Hook、导航、主题与通用 UI
      features/         analysis-detail、data-sources、group、knowledge、system-status
packages/
  contracts/
    src/                按领域拆分的 Zod 网络契约与兼容根导出
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

`apps/api/.env` 中的 `AUDIO_STORAGE_DIR` 同时承载混合模式的持久原音频和轻量模式的临时原音频；每条资产会在 PostgreSQL 固化创建时的运行模式和保留策略。生产或容器环境必须显式挂载该目录，混合模式还需要备份。对象存储模式的原音频直接进入租户配置的权威 OSS，不在该目录长期保存。三种模式、清理边界和接口见[音频运行模式](docs/audio-runtime-modes.md)。

FFmpeg 是整文件转写的必需能力。配置 `FFMPEG_PATH` 后，API 启动时会非致命探测可执行文件；缺失或检查失败不会阻止知识库嵌入和 API 启动，但会禁用音频转写。临时单声道 MP3 写入 `AUDIO_TRANSCRIPTION_TEMP_DIR`，转写模型固定为 `qwen-audio-3.0-asr-flash-filetrans`，失败时不会自动切换模型。API 还会校验仓库内固定的 Silero VAD v6.2.1 ONNX 模型；VAD 不可用时仍可由用户明确选择整文件模式，服务端不会静默回退。

按说话轮次分段使用北京地域 `qwen-audio-3.0-asr-flash-filetrans`。供应商端点、模型、通知方式和能力绑定由 PostgreSQL 配置中心管理；Credential 可选择 AES-256-GCM 加密入库，或由服务器本地只读 `credentials.yaml` 提供。混合与对象模式通过 `audio_staging` OSS 短期中转预处理音频；轻量模式使用 DashScope Instant 临时文件区并提交 `oss://` 地址。三种路径都持久化 Provider 任务 ID 和 Checkpoint，恢复时不会重复提交已经创建的任务。

`polling` 模式每次只查询一次 DashScope 任务状态，按 2/5/10/15 秒递增间隔把下次查询时间写入数据库并释放 worker，worker 按最近持久化截止时间精确唤醒，六小时后停止查询。所有后台任务在事务提交后通过 PostgreSQL `LISTEN/NOTIFY` 低延迟唤醒，15 秒扫描只作为通知丢失、监听重连和进程恢复的安全兜底；任务表与 `FOR UPDATE SKIP LOCKED` 仍是权威事实和领取机制。该监听固定占用连接池中的一个连接。`eventbridge` 模式的回调地址固定指向 `POST /api/webhooks/dashscope/async-task-finished`；在华北 2（北京）地域 default 事件总线创建规则，筛选 `source=acs.dashscope`、`type=dashscope:System:AsyncTaskFinish` 和模型后缀 `:qwen-audio-3.0-asr-flash-filetrans`，HTTP 目标选择“完整事件”并填写相同 Token。回调 URL 必须可由 EventBridge 通过公网或已配置 VPC 访问；反向代理后的外部完整 URL 必须与环境变量和 EventBridge 目标完全一致。`AUDIO_TRANSCRIPTION_MAX_IN_FLIGHT` 同时约束两种模式中等待供应商终态的任务数，首次部署建议保持 `1`。

转写发布后，供应商正文作为不可变 Raw Transcript 保存；同一音频允许多个 ASR Run，并可手动固定成功版本或自动跟随最新成功版本。混合与对象模式在用户确认 Transcript 后独立启动声学情绪和角色识别。轻量模式默认把声学情绪绑定到 ASR Run，内部按 `ASR → 声学情绪 → 清理` 执行；关闭开关后该 Run 返回 `not_requested`，ASR 成功即删除临时音频。角色识别和业务工作流始终只依赖当前选中的 Transcript。

分析详情和数据源音频列表使用 `expo-audio` 播放原始上传文件。API 通过租户隔离的 `GET/HEAD /api/audio-files/:audioFileId/content` 提供媒体流并支持单段 HTTP Range；客户端不会接收 `storage_key` 或服务器路径。详情页顶部播放器提供真实进度、倍速和跳转，正文片段按钮只播放对应时间范围并在片段结束时自动暂停。播放器仅在当前页面前台运行，离页即停止，不启用后台或锁屏播放。

分析详情的“模型详情”标签页按当前 ASR 修订展示转写、情绪、角色和当前分组业务分析的运行记录。它从 PostgreSQL 安全审计表读取模型、状态、耗时、Token、执行步骤、工具调用、检索查询、知识库名称和命中文档定位；不展示模型隐藏推理、完整提示词、原始模型输出或知识块正文。功能上线前的历史运行不会回填或伪造轨迹。

销售复盘使用持久化 LangGraph 组织“准备 → 检索规划 → 并行检索 → DeepAgent 分析 → 结构校验 → 原子发布”。检索规划使用独立的非思考模型，输出上限 768 tokens、超时 30 秒；主结构化分析使用非思考模型，输出上限 6000 tokens、单次模型超时 60 秒、工作流总超时 120 秒；结构修复使用 4096 tokens、超时 45 秒。进程中断会使用原 thread 从最后成功节点继续；可重试错误会在 15 秒和 60 秒后最多恢复两次。长转写会按窗口保存分析结果，已完成窗口不会重复调用，最终汇总只消费窗口摘要。任务终态后会删除 checkpoint，清理失败不影响已发布结果，并在下次 API 启动时补偿。

音频上传支持 MP3、WAV、M4A、AAC、FLAC、OGG 和 WebM，单文件上限为 200 MB，服务端在上传完成时校验不超过 12 小时。上传通过流式会话写入，长音频进入异步转写；超过限制时请先压缩或拆分。

`apps/api/.env` 只保存启动、基础设施、路径、运维开关和根安全配置；供应商普通配置与能力绑定保存在 PostgreSQL，Secret 由 Database 或 Local Credential Provider 提供。API 仍只直接读取该 `.env` 文件，不合并 `process.env`。完整边界、HTTPS/localhost 判定、`credentials.yaml`、Docker 只读挂载和旧变量导入见 [配置与 Credential 指南](docs/configuration.md)。移动端由 Expo CLI 自动加载 `apps/mobile/.env`，其中客户端可用变量必须以 `EXPO_PUBLIC_` 开头：

```dotenv
EXPO_PUBLIC_API_URL=http://localhost:3001
```

`EXPO_PUBLIC_*` 会被写入客户端 bundle，不得放置密码、令牌或其他秘密。修改该文件后，需要在 Expo Go 中执行完整 Reload 才能确认新值已生效。详见 [Expo 环境变量文档](https://docs.expo.dev/guides/environment-variables/)。

API 的 PostgreSQL 配置继续使用 `POSTGRES_HOST`、`POSTGRES_PORT`、`POSTGRES_USER` 等分字段变量。首次启动还必须设置 `CREDENTIAL_MASTER_KEY`、`CONFIGURATION_ADMIN_TOKEN`、`LOCAL_CREDENTIALS_FILE` 和 `TRUSTED_PROXY_CIDRS`。缺少供应商连接、Credential alias 或能力绑定只会禁用对应 AI 能力并返回 `CONFIGURATION_REQUIRED`，健康检查和“更多”页仍可使用。Redis 字段仍仅作未来边界预留。

### 可选 AI 执行报告

知识问答、文档入库、音频 ASR、角色/情绪识别和销售复盘支持本地 Markdown 执行报告。它用于开发与测试诊断，不是单元测试覆盖率或 CI 测试结果。报告默认关闭；需要时在 `apps/api/.env` 设置：

这里的本地文件报告与移动端“模型详情”相互独立：关闭下列开关不会关闭 PostgreSQL 中字段受限的产品审计；本地报告也不会通过模型详情 API 暴露。

```dotenv
AI_EXECUTION_REPORT_ENABLED="true"
AI_EXECUTION_REPORT_OUTPUT_DIR=".ai-execution-reports"
AI_EXECUTION_REPORT_CONTEXT_ENABLED="false"
AI_EXECUTION_REPORT_TOOL_CONTENT_ENABLED="false"
AI_EXECUTION_REPORT_OUTPUT_ENABLED="false"
AI_EXECUTION_REPORT_REASONING_ENABLED="false"
AI_EXECUTION_REPORT_STT_RAW_RESPONSE_ENABLED="false"
```

启用 `AI_EXECUTION_REPORT_ENABLED=true` 后，每一次真实模型调用都会写入 `Model Calls`：聊天模型按实际发送顺序记录带显式 `role` 的消息（包括 `system` 后面的 `user`），并记录模型可见输出、工具调用、状态、耗时、Token 和尝试次数。Embedding 仅记录输入文本与向量数量、维度、Token、费用摘要，不记录向量；音频输入固定显示为 `[OMITTED_AUDIO]`。销售复盘会单独生成 `audio-business-analysis` 报告，覆盖主动检索规划、Agent 各轮调用、知识工具、结构校验、发布和失败。

每个输入消息和输出分别进行脱敏与最多 120,000 字符截断；截断项会保留原始字符数、SHA-256 和 `[truncated]` 标记，因此一个超长调用不会吞掉后续调用。鉴权信息、签名 URL 查询参数、本地路径、长 Base64、音频正文与 Embedding 向量不会写入报告。报告可能包含完整转写和知识库正文，只能在受控测试环境短期开启，并按敏感业务数据管理。

`AI_EXECUTION_REPORT_CONTEXT_ENABLED`、`AI_EXECUTION_REPORT_TOOL_CONTENT_ENABLED` 和 `AI_EXECUTION_REPORT_OUTPUT_ENABLED` 仅控制额外的 Context、Tool Content 与汇总 Output 章节，不会关闭 `Model Calls` 中的实际 Prompt/Output。隐藏 reasoning 仍只由 `AI_EXECUTION_REPORT_REASONING_ENABLED` 控制。关闭总开关时不创建报告，也不执行额外写盘。

每个转写修订按“任务提交”和“终态完成”生成独立的 `audio-transcription` 阶段报告，记录所选模型、预处理、供应商等待耗时、结果下载、发布和失败持久化。模型返回的规范化转写片段会作为可见输出记录；连接地址、`storage_key`、文件路径、音频、base64、密钥和 Provider 原始错误包不会进入通用报告。

`AI_EXECUTION_REPORT_STT_RAW_RESPONSE_ENABLED=true` 独立启用逐 HTTP 响应的 JSON 测试报告，即使通用 Markdown 报告关闭也会生效。DashScope 的任务提交、Polling 的 `task_status` 响应或 EventBridge 完成回调，以及最终 Qwen 转写 JSON 会写入 `.ai-execution-reports/stt-raw/YYYY-MM-DD/`。报告包含供应商、响应阶段、模型、修订、尝试、HTTP 状态和经过保护的原始响应文本；请求音频、鉴权头与完整响应头不会进入文件，OSS 签名查询参数会脱敏。单响应最多保留 2 MiB 文本，超限时记录原始字节数和 SHA-256，报告写入失败不影响转写。

FFmpeg/VAD 模式将录音流式转为 16kHz 单声道 MP3，保留原时间轴 Manifest 后提交一个 Qwen Filetrans 任务，以维持整段录音的 Speaker ID 连续性；不会按 45 秒拆分。长音频业务分析会按最多 50 个片段或约 6000 个中文字分层处理并持久化窗口 checkpoint。

转写只使用 DashScope Filetrans：默认先以 Silero VAD 检测人声，仅压缩连续超过 30 秒的非人声区间，再由 FFmpeg 生成 16kHz 单声道整文件 MP3；用户也可明确选择保留完整音频。两种通知模式都经短期 OSS 对象和签名 URL 异步提交，并开启 `diarization_enabled=true`。Polling 通过到期任务的单次 `/tasks/{task_id}` 查询发现终态；EventBridge 通过原始 Body、Token、时间窗和 RSA 签名校验后快速落库，且该模式绝不查询任务状态。两种来源最终都由同一后台完成路径下载结果、校验并发布。VAD 清单随 revision 持久化，供应商时间戳发布前恢复到原录音时间轴，被删除区间写入无效片段表。结果严格要求每句包含 `speaker_id` 和有序有效毫秒时间戳：Speaker 变化或同一 Speaker 停顿达到 1500ms 时开始新段，相邻同 Speaker 在不足 1500ms 且合并后不超过 240 字时合并，供应商单句不会被硬拆。业务角色和情绪始终为 `unknown`。

数据源转写、分析详情和知识文档入库均以 REST 快照作为权威首帧，并在存在进行中任务时通过 SSE 接收状态增量；健康连接下不会周期刷新完整页面。连接连续失败后移动端临时使用 5 秒 REST 降级，并每 30 秒尝试恢复 SSE。音频卡片显示 `排队 → 预处理 → 模型转写 → 等待模型完成 → 校验 → 发布` 的持久化阶段和单调百分比；模型正文始终不会进入进度接口或弹窗。

`AI_EXECUTION_REPORT_OUTPUT_ENABLED="false"` 是附加汇总 Output 章节的安全默认值，并且不控制 Model Calls 的 Prompt/Output 或独立 STT 原始响应报告。两类报告目录都已被 Git 忽略且不会自动清理，避免后台任务误删诊断证据；已生成的历史报告不会回填或重新执行。

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
- Markdown、DOCX、XLSX 单文件上传、异步解析、分块、嵌入与 SSE 状态增量（REST 降级）
- PostgreSQL 租户隔离、revision 原子发布、HNSW 检索和引用回溯
- PostgreSQL 数据源创建、编辑、软归档、分组关联/解除，以及本地批量音频上传与软归档
- PostgreSQL 音频上传时间线和版本化分析结果查询纵切片
- 数据源音频的后台 ASR、尽力而为的 Speaker 分离、实际响应时间戳及分块级实时进度
- Raw Transcript 与版本化 Confirmed Transcript 分离、逐片段修正和确认前分析门槛
- 基于 Qwen3.5-Omni 的逐片段声学情绪分析，以及基于 DeepSeek 的录音级说话人业务角色识别
- DeepSeek + DeepAgents 知识问答、无证据拒答与短会话 checkpoint
- LangGraph 持久化销售复盘、并行检索恢复、有界重试与幂等发布
- 可选的知识问答、入库与音频转写 Markdown 执行诊断报告
- 移动端知识库列表、文档/块详情、上传、动态问答反馈、最近六轮只读历史和可返回聊天的引用跳转
- 更多页中的 API 加载、在线、离线、超时和重试状态
- `GET /api/hello` HelloWorld 接口及共享 Zod 契约

## 当前边界

本里程碑不包含真实鉴权、转写修正统计或 Correction Dataset 导出、意图分析、跨录音业务聚合、情绪融合评分、精确声学数值测量、数据源同步、Redis、OCR、PDF、旧版 Office、独立 Worker 部署或 EAS Build。API 和 Worker 仍在同一进程；混合与轻量模式的本地音频路径只支持单 API 主机，对象存储模式虽不依赖本地持久盘，但多实例前仍需把进程内 SSE 失效信号改为跨实例分发。详见 [文档索引](./docs/README.md)、[架构说明](./docs/architecture.md)与[音频运行模式](./docs/audio-runtime-modes.md)。

在 Windows 上无法运行 iOS Simulator；iOS 本轮通过 Expo bundle 导出、TypeScript 检查和应用配置校验，最终原生运行验收需在 macOS/Xcode 环境完成。
