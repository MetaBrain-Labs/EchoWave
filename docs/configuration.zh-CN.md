# 配置与 Credential 指南

[English](./configuration.md) | **简体中文**

EchoWave 将服务端配置分成三个边界：`apps/api/.env` 保存启动级配置，PostgreSQL 保存租户级普通配置，Credential Provider 保存密钥。移动端还单独保存当前服务器根地址。管理员口令在“更多 → 服务配置”校验一次，该页的租户 ASR 默认上下文与入口卡片指向的 AI 配置、运行模式共用这次校验；未校验时 AI 配置与运行模式只显示校验引导，不加载内容。服务器地址与推送登记在“更多 → 服务状态”。语言和默认分析方式属于设备级偏好，位于“更多 → 通用设置”。

## 当前模型与平台选择

EchoWave 当前以阿里云百炼和通义千问能力为主，是因为百炼在同一平台覆盖文本生成、Embedding、ASR 和全模态模型，同时提供 DeepSeek 等第三方模型的 OpenAI-compatible 接口。部署者可以用一个阿里云账号开通大部分模型服务和 OSS，减少跨平台账号与账单管理；这不表示所有能力共用同一种密钥。

- DashScope 连接使用百炼 API Key，默认承载全部能力：Qwen Embedding、文件转写、声学情绪以及文本生成（知识问答、角色识别、说话人复核、业务分析）。
- DeepSeek 是可选的成本备选方案。同一个模型在 DeepSeek 官方 API 的缓存命中价格低于百炼同名模型；对成本敏感时，可在 AI 配置中把文本类能力改绑到 DeepSeek 连接。它可以使用 DeepSeek 官方 API，也可以把 Base URL 改为百炼业务空间的 OpenAI-compatible endpoint，并使用百炼 API Key。
- 阿里云 OSS 连接使用 AccessKey ID/AccessKey Secret，不使用百炼 API Key。即使它们属于同一阿里云账号，也必须按不同 Credential 类型保存。

百炼的地域、业务空间和模型可用范围可能不同。使用百炼承载 DeepSeek 时，必须使用目标地域实际提供的 endpoint 和模型，不能直接照抄其他账号的 Workspace ID。官方说明见[什么是阿里云百炼](https://help.aliyun.com/zh/model-studio/what-is-model-studio/)和[百炼 DeepSeek API](https://help.aliyun.com/zh/model-studio/deepseek-api)。

当前权威默认绑定来自 `packages/contracts/src/settings.ts`：

| 能力                           | Provider 类型      | 默认模型或后端                       |
| ------------------------------ | ------------------ | ------------------------------------ |
| 知识库 Embedding               | DashScope          | `qwen3.7-text-embedding`             |
| 知识问答                       | DashScope          | `qwen3.5-omni-flash`                 |
| 音频转写                       | DashScope          | `qwen-audio-3.0-asr-flash-filetrans` |
| 声学情绪                       | DashScope          | `qwen3.5-omni-flash`                 |
| 业务角色、说话人复核、业务分析 | DashScope          | `qwen3.5-omni-flash`                 |
| 临时音频中转、权威对象存储     | 阿里云 OSS（固定） | `aliyun-oss`                         |

除两个 OSS 后端外，所有能力都可以在 AI 配置中搜索并改选模型。候选来自百炼官方模型列表接口 `GET /api/v1/models`，并按能力责任过滤：

- 文本生成能力只展示支持文本生成（`TG`）的模型；
- 声学情绪额外要求模型支持音频输入，因此纯文本模型和 ASR 专用模型都不会出现；
- 知识嵌入只展示文本向量（`TR`）模型，音频转写只展示语音识别（`ASR`）模型。

选择器第一项固定是该能力的默认模型并标注「已验证」；只有本仓库已经适配并验证过契约的模型才能通过保存时的校验，目录里其余模型可以浏览和搜索，但选择会被拒绝并提示尚未适配。置顶项只在当前连接确实能提供该模型时才出现：DeepSeek 连接看到的始终是它自己可用的模型，不会出现百炼的默认模型；目录读取失败时也遵守同一规则。

- Embedding：向量维度固定为 1024，选择其他维度的模型会被直接拒绝（`pgvector` 列类型与检索契约都写死了该维度）。改选已验证的向量模型后，旧文档需要重新入库才会回到检索结果里，因为检索按 `embedding_model` 过滤。
- 音频转写：运行时要求整文件转写、说话人分离与词级时间戳，当前只有 `qwen-audio-3.0-asr-flash-filetrans` 声明了这些适配元数据，因此它是唯一可绑定的转写模型。

某个模型出现在多个能力的目录里是正常的：`qwen3.5-omni-flash` 同时具备文本生成与音频输入能力，因此它既是知识问答、角色识别、说话人复核、业务分析的默认模型，也是声学情绪的默认模型。置顶行的提示会写明该模型在**当前能力**下已验证，避免误解为“只属于某个能力”。如果希望让知识问答改用一个纯文本模型（例如 `qwen3-max`），需要先在 `CAPABILITY_MODEL_REQUIREMENTS.knowledge_chat.verifiedModelIds` 中登记并实测该模型，它才会进入可选集合。

改选模型后，该模型是否具备本能力所需的能力由部署者自行确认；服务端只校验模型是否在能力目录内，以及维度等硬约束是否一致。模型列表响应中的价格、上下文长度与声明的向量维度只是选择参考，不参与计费计算，也不写入业务表。列表接口口径见[查询模型列表](https://help.aliyun.com/zh/model-studio/list-models)。

列表读取带三级回退：先按能力责任带筛选参数请求，被拒绝时退回只有分页参数的请求，再退回一次不带分页的请求；任何一次成功都在本地按能力责任过滤。缺少能力或模态元数据的响应不会清空目录，未适配的模型仍会在绑定校验处被拒绝。列表读取失败时选择器保留该能力已验证的默认模型（它不依赖列表接口），并显示粗粒度原因（例如「供应商返回 401」「网络或超时」），便于判断是凭据、地域还是网络问题，且不会暴露 API Key 或供应商响应体。切换供应商连接时模型字段会立即刷新：目录已加载就用新连接的默认模型或首个候选，目录尚未加载则清空并要求重新选择，绝不会沿用上一个连接的模型名。

配置页允许编辑模型名是为了支持经过适配和验证的后续版本，不代表任意模型现在都与 Prompt、结构化输出、时间戳、Speaker、Thinking 或恢复协议兼容。

## 智能重排披露

租户级重排开关开启且重排已配置时，问答回答、查看历史记录、业务分析报告与执行轨迹都会明确说明本次是否使用了重排及其效果：模型名、参与重排的候选条数、入选证据条数、其中因重排提升而入选的条数，以及耗时。重排未启用时不出现任何重排字样；重排已开启但降级时说明降级原因（例如尚未配置业务空间或重排模型），并声明本次使用向量检索顺序。

“重排提升”是效果代理指标，不是答案质量评分：它统计重排后入选、而纯向量顺序不会入选的证据条数；候选集合与顺序都没变时，文案会直接说明结果与向量召回一致。披露只包含可复算的计数与状态，不包含候选正文、相关性分数或 Credential。

## 百炼业务空间专属域名

新建或编辑 DashScope 连接只配置 Workspace ID 与地域。该字段填控制台“业务空间管理”或 API Key 弹窗中 **API Host** 的第一个点之前的部分，不要填完整域名：早期业务空间是 `llm-…`，较新的业务空间是 `ws-…`，二者都是合法取值。地域必须与 API Host 中的地域一致。服务端统一派生业务空间域名，并分别使用原生接口 `https://{workspaceId}.{region}.maas.aliyuncs.com/api/v1` 和 OpenAI 兼容接口 `https://{workspaceId}.{region}.maas.aliyuncs.com/compatible-mode/v1`。Embedding、重排、模型目录、文件转写和临时上传策略走原生接口；Qwen 对话类能力走兼容接口。默认地域为 `cn-beijing`，还支持 `ap-southeast-1`、`ap-northeast-1`、`eu-central-1`、`cn-hongkong` 与 `us-east-1`；API Key 必须属于同一地域和业务空间。

数据库中已有的 `baseUrl`、`compatibleBaseUrl` 和 `rerankBaseUrl` 仅作为只读兼容配置继续运行，不能再通过公开写接口保存。“更多”页会为旧配置显示迁移卡片；管理员输入统一的 Workspace ID 和地域后，服务端先用每条连接自己的 Credential 校验目标 `/api/v1/models`，所有连接都通过才在单个事务内创建新版连接 revision、更新当前能力绑定，并在缺失时补齐 `knowledge_rerank`。历史 revision 和已冻结任务不变。

官方地域、部署范围和域名见[百炼地域与接入域名](https://help.aliyun.com/zh/model-studio/regions/)。

运行模式决定 OSS 是否必需：

| 运行模式 | DashScope | DeepSeek（可选替换文本类能力） | 阿里云 OSS                                      |
| -------- | --------- | ------------------------------ | ----------------------------------------------- |
| 轻量本地 | 必需      | 仅在改绑文本类能力后必需       | 不需要                                          |
| 混合     | 必需      | 仅在改绑文本类能力后必需       | `audio_staging` 必需                            |
| 对象存储 | 必需      | 仅在改绑文本类能力后必需       | `audio_staging` 与 `audio_primary_storage` 必需 |

模式选择、原音频位置和清理语义见[音频运行模式](./audio-runtime-modes.md)，完整 Server 安装顺序见[Server 部署指南](./server-deployment.md)。

## 启动级 `.env`

从 `apps/api/.env.example` 创建本地 `.env`。API 只读取这一个文件，不合并启动进程的系统环境变量。除 HTTP、PostgreSQL、Redis、目录、FFmpeg、Worker 和诊断字段外，下列安全字段必须显式配置：

- `CREDENTIAL_MASTER_KEY`：恰好 32 个随机字节的规范 Base64，用于 AES-256-GCM。
- `CONFIGURATION_ADMIN_TOKEN`：至少 32 字符的随机管理口令。
- `LOCAL_CREDENTIALS_FILE`：服务器本地 YAML 的显式路径；不使用隐式默认路径。
- `TRUSTED_PROXY_CIDRS`：可覆写 `X-Forwarded-Proto` 的反向代理 IPv4/IPv6 CIDR，多个值用逗号分隔；没有可信代理时显式设置为空字符串。
- `PUSH_NOTIFICATIONS_ENABLED`：必须显式为 `true` 或 `false`；Self-hosted 默认使用 `false`。

供应商 URL、Bucket、模型、Thinking、DashScope 通知模式、回调 URL 和能力绑定不再属于启动级 `.env`。仅在升级期保留旧环境导入时，可用 `DASHSCOPE_WORKSPACE_ID` 和可选 `DASHSCOPE_REGION` 替代三个旧 URL 变量；结构化业务空间配置优先，地域省略时使用 `cn-beijing`。只有启用了 Expo Push access-token 安全的项目才设置可选 `EXPO_PUSH_ACCESS_TOKEN`；它是服务端 Secret，不能使用 `EXPO_PUBLIC_` 前缀。

## Local Credential Provider

本机部署可将 `LOCAL_CREDENTIALS_FILE` 指向：

- Linux/macOS：`~/.echowave/credentials.yaml`
- Windows：`C:\Users\<user>\.echowave\credentials.yaml`
- Docker：`/app/.data/secrets/credentials.yaml`

文件格式固定为：

```yaml
version: 1

credentials:
  dashscope-main:
    type: dashscope
    apiKey: sk-example
    eventBridgeCallbackToken: callback-example

  deepseek-main:
    type: deepseek
    apiKey: sk-example

  aliyun-oss-main:
    type: aliyun_oss
    accessKeyId: example-id
    accessKeySecret: example-secret
```

解析器拒绝未知字段、重复键、YAML 锚点/别名、自定义标签和超过 64 KiB 的文件，也不会执行环境变量插值。POSIX 文件必须仅服务账户可读：

```sh
chmod 600 ~/.echowave/credentials.yaml
```

Windows 应通过文件“属性 → 安全”仅授予当前用户或 API 服务账户读取权限。Docker 应以只读卷挂载并在宿主机设置 `0600`：

```yaml
services:
  api:
    volumes:
      - ./deploy/self-hosted/.data/secrets:/app/.data/secrets:ro
```

Provider 会在文件版本变化时完整重读，只有成功校验后才原子替换内存快照。无效更新会保留本进程最后一次有效快照供已创建任务继续使用，但阻止新连接或新能力绑定。Local alias 是任务版本的一部分；轮换时新增 alias、切换数据库连接引用，确认旧任务结束后再删除旧 alias，不要原地覆盖。

## 移动端服务器地址

`apps/mobile/.env` 由 Expo CLI 加载，客户端可见变量必须使用 `EXPO_PUBLIC_` 前缀，且会作为公开内容进入 bundle。`EXPO_PUBLIC_API_URL` 仅是 Development Build 或 Expo Go 尚无已保存地址时的开发默认值，不得包含密码或令牌。

App 将通过 `GET /health` 验证的规范化服务器根地址写入 AsyncStorage。已保存地址优先；REST、上传、SSE、音频媒体和推送设备登记都在请求发生时读取同一个运行时地址。修改服务器会终止旧连接、清空页面级状态并重新挂载业务导航。

`production-apk` 和 `production` profiles 设置 `EXPO_PUBLIC_REQUIRE_SERVER_SELECTION=true`，因此即使构建环境意外提供了 `EXPO_PUBLIC_API_URL`，Production Build 也会忽略它并要求首次手动连接。EAS 使用 remote app version source；自动发布只让 `production-apk` 递增 Android `versionCode`，用户可见 `version` 必须在提交中与稳定 Tag 和 Server package 版本保持一致。

地址只接受没有凭据、query、fragment 或业务路径的 HTTP/HTTPS origin。HTTP 仅允许 localhost、私有 IPv4、回环/链路本地 IPv6、共享地址空间和 `.local` 主机；公网地址必须使用 HTTPS。健康响应必须满足共享契约：

```json
{
  "name": "EchoWave",
  "service": "echowave-api",
  "version": "0.1.0",
  "apiVersion": 1,
  "status": "ok",
  "capabilities": {
    "remotePush": false
  }
}
```

`remotePush=false` 时 App 不请求通知权限、不加载设备注册流程；`true` 时仅原生 Build 会继续注册 Expo Push Token。Expo Go 保持安全降级。

## 连接安全规则

网页提交 Database Credential 仅允许三种情况：API socket 直接使用 HTTPS；真实 TCP 对端与 Host 都是 loopback/localhost；或真实 TCP 对端命中 `TRUSTED_PROXY_CIDRS` 且代理明确设置 `X-Forwarded-Proto: https`。非可信来源的转发头会被忽略。

HTTP + 非 localhost 时，页面持续显示：

> 当前连接不是 HTTPS，不能通过此页面提交 Credential。请在服务器本地配置 `credentials.yaml`，然后选择对应的 Local Credential alias。

此时 Secret 输入、粘贴、自动填充和提交均被禁用，服务端也会对任何嵌套、空值或批量 Secret 字段返回 `403 INSECURE_CREDENTIAL_TRANSPORT`。名称、HTTPS Base URL、模型、Thinking、通知方式、能力绑定和 Local alias 仍可修改。

所有普通管理请求使用 `Authorization: Bearer <CONFIGURATION_ADMIN_TOKEN>`。移动端仅在当前页面内存保存口令。远程 HTTP 下该口令没有传输机密性，存在被窃取和配置被篡改的风险；生产部署必须启用 HTTPS。

可编辑供应商 Base URL 必须为公网 HTTPS。服务端拒绝 localhost、私网、链路本地、保留地址、云元数据地址及解析到这些地址的域名。

## Database Credential 与任务 revision

Database Credential 使用随机 12 字节 IV、AES-256-GCM 认证标签以及绑定租户、Credential、版本和 Provider 类型的 AAD。API 只返回是否已配置和末四位掩码，不返回明文。

修改 Secret 会创建不可变 Credential version；修改连接会创建 Provider revision，并为受影响能力发布新的 binding revision。新请求使用当前 revision，已排队、运行、恢复或等待回调的任务继续使用创建时冻结的 revision。任务快照只保存 Database version ID 或 Local alias/type，不保存密钥。

## 从旧 `.env` 导入

升级期间可暂时保留旧 `DASHSCOPE_*`、`DEEPSEEK_*` 和 `ALIYUN_OSS_*` 变量。新环境应设置 `DASHSCOPE_WORKSPACE_ID` 和可选 `DASHSCOPE_REGION`；若它们存在，导入时优先派生专属原生/兼容地址。原有 `DASHSCOPE_BASE_URL`、`DASHSCOPE_COMPATIBLE_BASE_URL` 和 `DASHSCOPE_RERANK_BASE_URL` 仍可被旧部署读取，其中独立重排地址不再参与运行时路由。配置页只显示检测到的变量名和完整性，不显示值。点击“从服务器旧 `.env` 导入”后，API 在服务器内部读取 Secret、加密入库且不覆盖已有数据库配置；同一租户重复操作是幂等的。

导入可以在远程 HTTP 下触发，因为请求体不携带 Secret。导入成功后数据库立即优先并关闭该租户的 legacy fallback。随后删除旧供应商变量并重启，确认对应能力仍可运行；启动级字段继续保留。

如果不迁移旧 Secret，可先在服务器创建 `credentials.yaml`，然后通过配置页以 Local alias 建立连接。

## 知识原文件持久目录

API `.env` 必须配置 `KNOWLEDGE_STORAGE_DIR`，示例值为 `.data/knowledge`，相对路径从 API 目录解析。Compose 使用 `echowave_knowledge` 持久卷；备份时应与 PostgreSQL 一并备份。

原文件按 revision 独立保存，解析成功后不再删除。文档删除及版本淘汰由可恢复任务清理。`UPLOAD_TEMP_DIR` 继续兼容旧暂存输入；数据库仍引用的文件不得仅因时间较长而删除。
