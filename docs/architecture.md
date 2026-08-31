# EchoWave 架构说明

## RAG 纵切片

```text
Expo mobile ── validated JSON/multipart ──> Hono API
                                                │
               ┌────────────────────────────────┼────────────────────┐
               │                                │                    │
        PostgreSQL + pgvector          LangGraph workflows     DeepAgent nodes
        business source of truth       in-process workers      bounded tools only
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

## 文件结构与领域所有权

API 采用“领域优先、领域内分层”，顶层目录只表达稳定的技术边界：

```text
apps/api/src/
  bootstrap/       组合根、领域 runtime factory、分领域 seed、启动与统一关闭
  config/          HTTP、数据库、Redis、模型、音频和报告配置；env.ts 统一加载装配
  http/            app、错误映射、SSE 基础设施及按领域拆分的 routes
  ai-runtime/      跨领域结构化输出和模型调用生命周期基础能力
  knowledge/
    catalog/       知识库、文档和块目录
    retrieval/     检索 port、RetrievalChunk 与向量实现
    answer/        可信问答 Agent
    ingestion/     入库 workflow、worker 和生命周期持久化
  workspace/
    groups/        GroupService 与分组 Repository
    data-sources/  DataSourceService 与数据源 Repository
    audio/
      core/        播放、分析详情、转写确认与 AudioService
      transcription/  转写 Repository、供应商适配器、workflow 与 Worker
      post-analysis/  情绪/角色 Context、Repository、供应商适配器与 Worker
      business-analysis/  销售复盘 Context、Repository、LangGraph 与 Worker
      execution/   执行查询 port、PostgreSQL recorder、事件 mapper 与 Repository
```

- `http/app.ts`、`config/env.ts` 和 contracts 根 `index.ts` 是长期组合入口，不放置领域实现。
- `bootstrap/runtime.ts` 只创建跨领域共享资源并调用 knowledge、workspace、audio runtime factory；`bootstrap/seed.ts` 只维护事务和领域 seed 调用顺序。
- Route 只能依赖显式 Service port；Service 直接依赖所需的窄 Repository，不通过聚合 Service 或聚合 Repository 转发。
- Repository 拥有 SQL 与事务，Service 拥有用例协调，Route 拥有网络解析和状态码，Worker 拥有领取、恢复与停止生命周期。
- LangGraph workflow 使用 `state.ts`、`nodes.ts`、`graph.ts`；`addNode` 只引用有名称的节点函数，依赖经工厂或 runtime context 注入。
- 每个模型任务就近维护一个 `CONTEXT.ts`，只包含该任务的系统/修复指令和动态 user context builder；schema、请求、重试与持久化不得进入 Context。
- 文件只按职责、依赖方向和可独立测试边界拆分。大文件需要审查，但不设置行数阈值，也不为几行日期转换、表名生成或简单展示组件制造公共抽象。

移动端同样按 feature 拥有状态与展示：Screen 负责页面编排，复杂加载、实时订阅和确认流程进入 feature hook，组件及样式留在所属 feature。`shared/api` 按 groups、data-sources、audio-analysis 等资源拆分，并复用基础请求错误；只有确认存在复杂共享状态机时才进入 `shared/hooks`。

共享契约按 wire domain 拆分，analysis 下区分 transcript、post-analysis、business-analysis，audio 下区分 processing、transcription。拆分不得改变原 schema/type 名称或 JSON 形状。

## 数据与发布边界

- PostgreSQL 是知识库、文档、revision、chunk、任务、会话和运行记录的权威来源。
- 当前音频修订的用户可见 AI 执行轨迹同样由 PostgreSQL 承载。四类音频 worker 通过组合报告器同时写入可选本地诊断和始终启用的安全审计；安全审计只保存步骤、模型统计、工具名称、检索查询、知识库名称和命中文档定位，不保存提示词、模型原文、知识块正文或隐藏 reasoning。
- PostgreSQL 同时保存租户级分组、数据源、音频元数据和已发布音频分析修订版；音频二进制与第三方凭据不进入业务表。
- 手动上传音频先经扩展名、MIME 和媒体结构校验，再以随机文件名写入 `AUDIO_STORAGE_DIR`；数据库只保存相对 `storage_key`。文件写入或数据库事务失败时会补偿清理本批新文件。
- 音频播放通过租户隔离的内容路由读取本地权威文件。仓储只返回未归档、已上传音频的存储元数据，服务层验证路径仍位于 `AUDIO_STORAGE_DIR`，HTTP 层提供 `GET`、`HEAD` 与单段字节 Range；客户端始终以音频 ID 构造 URL，不接触存储键。移动端使用一个页面级 `expo-audio` 实例同步完整录音与正文片段播放，片段边界只来自已发布时间戳。
- 音频转写使用 `audio_analysis_revisions` 作为 PostgreSQL 队列，并把供应商、实际模型、分段模式、固定语言、声明能力、实际响应能力与预处理模式写入 revision 设置快照。`silero_vad` 路径以本地 ONNX 模型流式检测人声并压缩超过 30 秒的非人声区间，`whole_file` 路径保留完整音频；两者都通过 FFmpeg 生成单个 16kHz 单声道 MP3，经短期 OSS 对象和 24 小时签名 URL 提交北京地域 DashScope Qwen 文件转写，不在修订内自动切换模型或预处理模式。
- `transcript_segments.text` 永久保存供应商 Raw Transcript；人工确认通过 `transcript_confirmations` 与 `transcript_confirmation_segments` 保存完整不可变快照，并由 ASR revision 上的 active 指针选择当前 Confirmed Transcript。确认只替换正文快照，不重建片段或修改 Speaker、时间戳和既有分析指针。
- 情绪分析和角色识别使用 `audio_post_analysis_jobs` 作为两个独立队列。任务只能从已确认的 ASR revision 创建，并固化当前确认版本、模型和数据源自定义角色字典；worker 始终从该确认快照读取正文。两类 worker 各自单并发并通过 `FOR UPDATE SKIP LOCKED` 领取，因此可以并行运行但不会让同类型任务重入。
- 分组通过关联表连接知识库和数据源；分组可见音频由显式分享与关联数据源两条关系合并去重，页面计数不作为可写字段保存。
- 分组和数据源允许在当前固定租户内创建和软归档；归档数据源会从活动列表、分组统计和数据源继承的音频可见关系中排除它，但不会删除关联、音频事实或本地文件。
- 知识库保存当前只读的存储、索引、模型和解析模式；概览统计继续由活动文档事实动态聚合。
- 知识库可通过租户隔离的批量接口关联多个活动分组；批量校验和插入在同一事务内完成，重复关联保持幂等。
- 新音频修订版只有完整写入本次产生的场景和 Raw Transcript 后才替换当前版本指针，并以待确认状态展示；情绪与角色结果分别写入版本化结果表，并在各自事务的最后切换 revision 上的 active 指针。再次确认正文、后处理失败或重跑都不会覆盖旧分析结果，新 ASR revision 也不会读取旧 revision 的确认或后处理指针。
- 所有仓储 SQL 都包含 `tenant_id`，检索还同时约束知识库和文档当前生效 revision。
- `ingestion_jobs` 通过 `FOR UPDATE SKIP LOCKED`、租约和幂等 chunk 唯一键恢复执行。知识入库、音频转写、情绪、角色和业务分析任务在事务提交后统一发送 PostgreSQL `NOTIFY` 失效信号；同进程 worker 立即尝试领取，15 秒安全扫描只负责通知丢失、监听重连或未知写入路径。通知不携带任务正文，也不替代任务表。
- 分组业务分析使用持久化 LangGraph 表达 `prepare → plan_retrieval → retrieve_query 并行扇出 → deep_agent → validate → publish`。任务表仍是状态、进度和重试的权威来源；Graph 只 checkpoint 可序列化快照，仓储、模型和报告器通过 runtime context 注入。稳定 thread ID 绑定 workflow 版本和 job ID，`sync` durability 保证进入下一节点前 checkpoint 已落库。
- 业务分析进程中断时，启动恢复会把遗留 `running` 任务重新排队，使用原 thread 从最后成功节点继续，不消耗错误恢复预算。可重试错误最多在 15 秒和 60 秒后恢复两次；DeepAgent 是原子节点，节点内中断会重跑该节点，但不重跑已 checkpoint 的规划和成功检索分支。
- 业务分析发布在单事务中写入摘要、标签、证据和 head；同 job 已成功发布且仍为 head 时重复调用视为成功。成功或最终失败后删除 thread checkpoint，删除失败不回滚业务终态，由下次启动扫描补偿。
- 音频转写通过部分唯一索引阻止同一音频并发任务，并用 `FOR UPDATE SKIP LOCKED` 领取。DashScope 的任务 ID、临时 OSS 对象键和提交时间随修订持久化；提交后进入 `awaiting_result` 并释放 worker。Polling 模式只领取已到数据库截止时间的任务并单次查询状态，进程内定时器按全局最近的查询或六小时超时截止点精确唤醒；EventBridge 模式不查询状态，只等待验签回调。进程重启时只重新排队未完成提交的修订，已有 task ID 的修订从持久化截止点恢复对应发现机制，已持久化终态的修订直接重新领取完成阶段。
- Qwen Filetrans 适配器要求每个非空句子都有 `speaker_id` 与有序有效毫秒时间戳；Speaker 变化、同 Speaker 间隔达到 1500ms 或合并后超过 240 字软上限时创建新段。缺失 Speaker、时间戳异常或乱序直接以 `INVALID_MODEL_OUTPUT` 失败，不进行模型或分段回退。原始 ASR 只产生正文、Speaker 与时间戳，角色和情绪由后处理结果覆盖兼容字段。
- 情绪 worker 按说话轮次生成最多 5 分钟或 50 个目标片段的窗口，并加入前后各 1 秒上下文。窗口经 FFmpeg 转为音频后暂存到独立 OSS 前缀并交给 Qwen；网络最多重试三次，结构纠正一次，仍无效时递归二分，单片段失败则整项任务失败。
- 角色 worker 把完整有序转写、每个 `speakerKey`、核心角色和本次数据源角色快照发送给 DeepSeek。输出必须完整覆盖已观察说话人，角色必须在白名单内，证据片段必须属于对应说话人。
- 转写 worker 将阶段、当前 Chunk/动态总数、音频时间范围、网络尝试和更新时间持久化到当前修订。Polling 和 EventBridge 只负责发现并持久化首个供应商终态，结果下载、结构校验、时间轴恢复、发布与清理由同一完成路径处理；移动端通过单实例进程内事件总线唤醒的 SSE 展示业务进度，REST 仅负责首帧和连接失败后的临时降级。旧修订的结构尝试字段仅作兼容读取。
- 新 revision 仅在全部向量写入成功后才在单事务中成为 active revision；失败不会使旧内容离线。
- 原文件使用随机临时路径，发布成功或不可重试失败后删除；超过 24 小时的孤立文件由 worker 清理。
- 首期只允许单 API 实例。worker 任务唤醒已使用 PostgreSQL `LISTEN/NOTIFY`，但移动端 SSE 仍使用单实例进程内事件总线，PostgreSQL 快照始终是权威状态；扩展到多 API 实例前仍需为 SSE 失效信号引入跨实例分发，并把本地权威音频和临时处理文件迁移到可共享对象存储。DashScope 路径的 OSS 仅是带一天生命周期兜底的临时中转，不是权威音频存储。

### 为什么保留原生 PostgreSQL 接口

- 当前持久化热路径依赖 pgvector `vector(1024)`、cosine HNSW、会话级检索参数、`FOR UPDATE SKIP LOCKED`、部分索引、动态 schema 限定符和多表事务发布。
- 稳定版 Prisma 无法把上述能力全部表达为普通模型操作；即使引入 Prisma，向量检索、任务领取、索引和关键事务仍需要自定义 migration 与原生 SQL。
- 当前继续使用 `pg` 与显式 SQL，可让一套 migration 和事务模型保持权威。只有常规关系 CRUD 明显增长、且迁移收益足以覆盖双栈成本时，才重新评估 Prisma。

## 模型与 Agent 边界

- DashScope 原生 TextEmbedding 接口使用 `qwen3.7-text-embedding`，固定输出 1024 维密集向量，文档批次最多 20；文档发送 `text_type=document`，查询发送 `text_type=query` 并添加英文检索指令。
- `qwen-audio-3.0-asr-flash-filetrans` 固定使用 `speaker_turn`，预处理可明确选择 `silero_vad` 或 `whole_file`。Silero 清单与临时 OSS 对象键原子保存，重启恢复终态完成阶段后仍用压缩时长校验供应商结果并把时间戳映射回原录音；跨折叠边界的模糊结果拒绝发布。OSS 或 FFmpeg 缺失时模型保持可见但禁用；EventBridge 配置只在 `eventbridge` 模式要求，Polling 不依赖公网回调。VAD 缺失时整文件模式仍可显式选择，绝不静默降级。
- `qwen3.5-omni-flash` 仅负责逐片段声学情绪，通过北京地域 OpenAI-compatible Chat Completions 接收签名 OSS URL；Prompt 与 Schema 描述为英文，用户正文保持原文。结果必须逐一覆盖目标片段，并保存固定枚举、置信度及声音线索。
- `deepseek-v4-flash` 以非思考模式和 JSON Output 识别录音级业务角色。核心角色为“销售、客户、其他、未知”，数据源可在此基础上增加最多 16 个自定义角色。
- 检索使用 cosine HNSW、`ef_search=100` 和 pgvector iterative scan，初召回 30，去重和文档配额后最多向 Agent 提供 8 块/12000 字符。
- DeepAgent 使用 DeepSeek `deepseek-v4-flash`、结构化 `{ answer, grounded, citedChunkIds }` 输出和 PostgreSQL checkpointer。
- 文件系统权限全部拒绝，不配置 skills、长期记忆或子代理；业务工具只有租户范围内的 `search_knowledge`，单轮最多实际执行四次。
- 销售复盘的外层恢复边界是 LangGraph；DeepAgent 只作为其中一个原子分析节点，保留检索工具白名单、调用次数限制、结构修复和证据安全校验，不配置内部 checkpointer。
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

分析详情的“模型详情”从 `ai_execution_runs` 与 `ai_execution_events` 读取当前已发布修订的产品审计轨迹。ASR、情绪、角色运行不依赖分组；业务分析轨迹只在请求分组通过音频访问校验后返回。旧修订和功能启用前的运行不回填，也不会从模型结果反推不存在的执行过程。进程重启时遗留的 `running` 记录收敛为 `interrupted`，重新排队后的工作生成新的运行记录；业务分析每轮 checkpoint 恢复也生成独立运行记录，不覆盖之前的中断或失败轨迹。

产品审计与下面的本地诊断报告是两个明确边界：产品审计始终启用但字段严格受限，本地报告默认关闭且可在受控环境记录更完整的开发诊断。移动端展示的“分析过程”是阶段和决策事实摘要，不是模型隐藏链路推理。

可选执行报告以一次 `rag-answer`、`knowledge-ingestion` 或 worker 阶段为边界，在运行结束后生成一份本地 Markdown。问答报告关联知识库、会话和 `rag_run`；入库报告关联 job、文档和 revision；ASR 按提交与终态完成生成阶段报告，均关联同一 revision 及安全的数据源/导入批次/音频快照。失败时继续记录 `persist-failure` 和失败清理，报告关闭或落盘失败都不能改变转写结果。

该报告不是 PostgreSQL 权威审计的替代品，也不作为客户端进度、HTTP 响应或恢复机制的数据源。客户端实时状态来自修订上的结构化活动字段；报告在执行结束时一次性写入，用于事后诊断。功能关闭时使用 no-op recorder，不创建目录或序列化上下文；写文件失败只产生脱敏 warning，不能改变原始业务结果。

STT 的 DashScope 任务提交、Polling 状态查询或 EventBridge 回调，以及结果获取均记录安全的执行阶段元数据。提交和终态完成分别生成同一 revision 下的阶段报告；修订结束还记录供应商、分段模式、终态来源、身份作用域和最终展示段数。输出经过响应结构、Speaker 与时间边界校验；音频与完整正文不进入错误详情或客户端进度接口。

默认 Markdown 报告只包含安全元数据。独立的 `AI_EXECUTION_REPORT_STT_RAW_RESPONSE_ENABLED=true` 会把 DashScope 的提交响应、Polling `task_status` 响应或 EventBridge 完成回调，以及最终 Qwen 转写 JSON 写入 `stt-raw`，不依赖通用报告开关。成功、非 2xx、无效 JSON 和校验失败响应都保留；正文最多保留 2 MiB，记录原始字节数和 SHA-256，并清除疑似密钥、Bearer、OSS 签名参数、长 base64 与本地路径。请求音频、鉴权头和完整响应头在任何模式下都不得写入。报告目录由 Git 忽略且不自动清理。

## 配置与安全

- `apps/api/.env` 是 API 唯一配置来源，不与系统环境变量合并，也不提供隐式默认值。
- 数据库 migration 与 LangGraph `setup()` 只由显式 `pnpm --filter @echowave/api migrate` 执行。
- `EXPO_PUBLIC_API_URL` 会进入客户端 bundle，不得放置密钥。
- API 默认不记录完整正文、完整模型上下文、provider 原始错误或 reasoning；本地诊断内容只能通过显式开关启用，密钥始终禁止记录。
- Redis 仍是未来缓存/协调边界，不参与首期 RAG，也不能成为第二业务真相源。
