# EchoWave 架构说明

## RAG 纵切片

```text
Expo mobile ── validated JSON/multipart ──> Hono API
                                                │
               ┌────────────────────────────────┼────────────────────┐
               │                                │                    │
        PostgreSQL + pgvector          LangGraph ingestion     DeepAgent query
        business source of truth       in-process workers      search_knowledge only
               │                                │                    │
               └──── active revision + chunks ──┴──── HNSW ─────────┘
```

`@echowave/contracts` 是全部 JSON 网络契约的唯一权威来源。API 生产端和移动端消费端都执行 Zod 运行时解析。客户端从不提交 `tenant_id`；固定开发租户只由 `apps/api/.env` 注入。

## 模块与依赖方向

```text
apps/mobile/src/app
        │
        ▼
apps/mobile/src/features ──> apps/mobile/src/shared
        │                              │
        └──────── @echowave/contracts ◄┘

apps/api/src/bootstrap ──> http / knowledge / infrastructure / config / ai-observability
apps/api/src/http ───────> knowledge ──> answer / embeddings / ingestion / persistence
apps/api/src/http ───────> @echowave/contracts <──── apps/mobile/src/features
```

- `apps/mobile/src/app` 只负责路由参数归一化、导航回调和 screen 渲染；业务状态归属 feature，跨 feature 的稳定能力归属 `shared`。
- 移动端使用 `@/*` 指向 `apps/mobile/src/*`。`shared` 不得反向依赖 `features`，feature 之间也不通过导入另一个 feature 的内部实现来共享基础设施。
- `apps/api/src/bootstrap` 是组合根；`http` 只处理传输，`knowledge` 负责领域用例，`infrastructure` 只提供 PostgreSQL 连接设施。
- `ai-observability` 提供框架无关的旁路执行记录；知识模块只依赖 recorder 接口，不依赖 Markdown 文件实现。
- 知识模块按生命周期形成深模块：可信回答、embedding、入库和持久化。服务、回答模块和 worker 直接依赖所需窄仓储，不设置委托式总仓储。
- `packages/contracts` 按通用错误、知识库、文档和 RAG 拆分，包根继续作为公共导出兼容面。

## 数据与发布边界

- PostgreSQL 是知识库、文档、revision、chunk、任务、会话和运行记录的权威来源。
- PostgreSQL 同时保存租户级分组、数据源、音频元数据和已发布音频分析修订版；音频二进制与第三方凭据不进入业务表。
- 手动上传音频先经扩展名、MIME 和媒体结构校验，再以随机文件名写入 `AUDIO_STORAGE_DIR`；数据库只保存相对 `storage_key`。文件写入或数据库事务失败时会补偿清理本批新文件。
- 音频转写使用 `audio_analysis_revisions` 作为 PostgreSQL 队列，并把实际模型、声明能力与 `ffmpeg/direct` 模式写入 revision 设置快照。FFmpeg 把源文件转为 16kHz 单声道 MP3，以 45 秒无重叠分块；文本退化或连续超时会原位细分到约 22 秒、11 秒，十秒为下限。direct 仅允许不超过 45 秒的受支持音频。单并发 worker 通过 OpenRouter STT 端点接收 words、segments 或 text，不使用 Gemini Chat 或结构生成，也不在修订内自动切换模型。
- 分组通过关联表连接知识库和数据源；分组可见音频由显式分享与关联数据源两条关系合并去重，页面计数不作为可写字段保存。
- 分组和数据源允许在当前固定租户内创建和软归档；归档数据源会从活动列表、分组统计和数据源继承的音频可见关系中排除它，但不会删除关联、音频事实或本地文件。
- 知识库保存当前只读的存储、索引、模型和解析模式；概览统计继续由活动文档事实动态聚合。
- 知识库可通过租户隔离的批量接口关联多个活动分组；批量校验和插入在同一事务内完成，重复关联保持幂等。
- 新音频修订版只有完整写入本次产生的场景、转写及可选分析内容后才替换当前版本指针；ASR-only 修订允许摘要与标签为空，失败重跑不会覆盖旧结果。
- 所有仓储 SQL 都包含 `tenant_id`，检索还同时约束知识库和文档当前生效 revision。
- `ingestion_jobs` 通过 `FOR UPDATE SKIP LOCKED`、租约和幂等 chunk 唯一键恢复执行。
- 音频转写通过部分唯一索引阻止同一音频并发任务，并用 `FOR UPDATE SKIP LOCKED` 领取；单实例重启时会重新排队中断修订。
- 转写适配器校验时间戳边界和顺序，并用重复覆盖率、文本/时间密度、Markdown 和短句碎片拒绝明显退化结果。words 按 Speaker 变化、750ms 停顿或终止标点成段；无 Speaker 时使用 `Speaker 0`，纯 text 仅获得块级时间范围。业务角色与情绪固定为 `unknown`，不会从正文猜测。失败详情与执行报告只记录安全问题码和统计。
- 转写 worker 将阶段、当前 Chunk/动态总数、音频时间范围、网络尝试和更新时间持久化到当前修订。移动端按 2 秒轮询展示，进度按已完成音频区间保持单调；旧修订的结构尝试字段仅作兼容读取。
- 新 revision 仅在全部向量写入成功后才在单事务中成为 active revision；失败不会使旧内容离线。
- 原文件使用随机临时路径，发布成功或不可重试失败后删除；超过 24 小时的孤立文件由 worker 清理。
- 首期只允许单 API 实例。对象存储和独立 worker 是多实例部署的前置条件。

### 为什么保留原生 PostgreSQL 接口

- 当前持久化热路径依赖 pgvector `vector(1024)`、cosine HNSW、会话级检索参数、`FOR UPDATE SKIP LOCKED`、部分索引、动态 schema 限定符和多表事务发布。
- 稳定版 Prisma 无法把上述能力全部表达为普通模型操作；即使引入 Prisma，向量检索、任务领取、索引和关键事务仍需要自定义 migration 与原生 SQL。
- 当前继续使用 `pg` 与显式 SQL，可让一套 migration 和事务模型保持权威。只有常规关系 CRUD 明显增长、且迁移收益足以覆盖双栈成本时，才重新评估 Prisma。

## 模型与 Agent 边界

- OpenRouter `qwen/qwen3-embedding-8b` 固定输出 1024 维，文档批次最多 64；只有查询添加英文检索指令。
- OpenRouter `/api/v1/audio/transcriptions` 接收 base64 音频分块。默认模型是 `x-ai/grok-stt-1.0`，允许单次选择 `qwen/qwen3-asr-1.7b`、`openai/whisper-large-v3`、`openai/gpt-transcribe` 或 `mistralai/voxtral-mini-transcribe`。模型目录来自共享静态白名单；超时、网络、429 与 5xx 最多尝试三次，安全错误立即失败且不跨模型故障转移。
- OpenRouter 音频格式由分块携带：FFmpeg 模式恒为 MP3，direct 模式保留 MP3、WAV、M4A、AAC、FLAC、OGG 或 WebM。direct 的明确格式/大小拒绝不会自动回退，失败信息提示用户启用 FFmpeg 重跑。
- 检索使用 cosine HNSW、`ef_search=100` 和 pgvector iterative scan，初召回 30，去重和文档配额后最多向 Agent 提供 8 块/12000 字符。
- DeepAgent 使用 DeepSeek `deepseek-v4-flash`、结构化 `{ answer, grounded, citedChunkIds }` 输出和 PostgreSQL checkpointer。
- 文件系统权限全部拒绝，不配置 skills、长期记忆或子代理；业务工具只有租户范围内的 `search_knowledge`，单轮最多实际执行四次。
- 模型应选择最多 8 个最有代表性的引用；超出时先执行引用压缩。引用数量属于可纠正的质量约束，压缩仍超限但引用均通过本轮白名单时保留完整证据，不得误降级为“依据不足”。移动端默认展示前 4 条引用，其余来源由用户按需展开。
- 服务端只接受本次检索白名单中的 chunk ID。依据不足返回 `grounded=false`，不使用常识补答。
- 第五次及后续检索意图由工具中间件阻止；模型改用本轮已有块生成结果，服务端在完成引用白名单校验后追加“证据可能不完整”的稳定提示。工具限制不能降低引用合法性要求。
- 多轮检索的服务端总等待窗口为 45 秒，移动端知识问答请求为 50 秒；客户端晚于服务端终止，以便优先接收结构化超时错误。

### 为什么问知识库暂不流式返回

可信回答模块必须先完成 `DeepAgent invoke → JSON 恢复或纠正 → citation 白名单校验 → usage 汇总 → run 审计完成`，之后 Hono 才返回一个通过 `RagQueryResponseSchema` 校验的 JSON。任何无法直接解析的模型输出都会获得一次禁止继续检索的 JSON-mode 恢复机会；恢复仍失败才降级为稳定拒答。移动端同样在完整 body 到达后统一解析和渲染。

这不是 LangGraph 或 Hono 缺少流式能力，而是当前网络契约只承诺最终已验证结果。逐 token 输出需要新增产品级事件契约，区分临时文本、最终引用、用量、取消和失败，并处理“已展示文本后来被引用校验否决”的一致性问题；该协议应作为独立功能设计，不能通过简单替换 `invoke` 绕过可信性校验。

移动端等待期间展示的“唤醒 AI、连接知识库、检索知识库、生成结果中”是客户端交互反馈，不是服务端实时遥测。只有完整响应到达后展示的引用来源数量来自服务器已验证结果；进度卡片不会提前展示模型文本，也不会绕过引用白名单与审计落库。

当前知识库最近六个已完成问答通过独立只读接口查询。历史数据来自 `rag_runs` 审计记录，只包含已完成的问答摘要，不恢复为可编辑或可续聊的当前会话。

## AI 执行诊断边界

可选执行报告以一次 `rag-answer`、`knowledge-ingestion` 或 `audio-transcription` 为边界，在运行结束后生成一份本地 Markdown。问答报告关联知识库、会话和 `rag_run`；入库报告关联 job、文档和 revision；ASR 报告一一对应被 worker 领取的音频修订，关联安全的数据源/导入批次/音频快照，并记录 `preprocess → transcribe → validate-merge → publish → cleanup` 时间线。失败时继续记录 `persist-failure` 和失败清理，报告关闭或落盘失败都不能改变转写结果。

该报告不是 PostgreSQL 权威审计的替代品，也不作为客户端进度、HTTP 响应或恢复机制的数据源。客户端实时状态来自修订上的结构化活动字段；报告在执行结束时一次性写入，用于事后诊断。功能关闭时使用 no-op recorder，不创建目录或序列化上下文；写文件失败只产生脱敏 warning，不能改变原始业务结果。

STT 的每次 OpenRouter HTTP 尝试都是独立 Model Call，包含分块序号、网络重试、所选模型、Provider、Generation ID、耗时、HTTP 状态、安全失败分类和可用的 usage/费用。输出经过响应结构、时间边界与文本质量校验；重复覆盖率、密度等安全统计可进入报告和修订 `error_details`，音频与完整正文不进入报告、错误详情或客户端进度接口。

默认报告只包含安全元数据。`AI_EXECUTION_REPORT_OUTPUT_ENABLED=true` 时仅把失败的 ASR 模型输出写入本地报告，单次最多 20,000 字符、单修订最多 40,000 字符；成功正文始终排除。音频、base64、提示词、密钥、密码、认证头、Cookie、连接地址、绝对/临时路径和 Provider 原始错误包在任何模式下都不得写入。报告目录由 Git 忽略且不自动清理。

## 配置与安全

- `apps/api/.env` 是 API 唯一配置来源，不与系统环境变量合并，也不提供隐式默认值。
- 数据库 migration 与 LangGraph `setup()` 只由显式 `pnpm --filter @echowave/api migrate` 执行。
- `EXPO_PUBLIC_API_URL` 会进入客户端 bundle，不得放置密钥。
- API 默认不记录完整正文、完整模型上下文、provider 原始错误或 reasoning；本地诊断内容只能通过显式开关启用，密钥始终禁止记录。
- Redis 仍是未来缓存/协调边界，不参与首期 RAG，也不能成为第二业务真相源。
