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
- 分组通过关联表连接知识库和数据源；分组可见音频由显式分享与关联数据源两条关系合并去重，页面计数不作为可写字段保存。
- 新音频分析修订版只有完整写入场景、转写、摘要与标签后才替换音频的当前版本指针，失败重跑不会覆盖旧结果。
- 所有仓储 SQL 都包含 `tenant_id`，检索还同时约束知识库和文档当前生效 revision。
- `ingestion_jobs` 通过 `FOR UPDATE SKIP LOCKED`、租约和幂等 chunk 唯一键恢复执行。
- 新 revision 仅在全部向量写入成功后才在单事务中成为 active revision；失败不会使旧内容离线。
- 原文件使用随机临时路径，发布成功或不可重试失败后删除；超过 24 小时的孤立文件由 worker 清理。
- 首期只允许单 API 实例。对象存储和独立 worker 是多实例部署的前置条件。

### 为什么保留原生 PostgreSQL 接口

- 当前持久化热路径依赖 pgvector `vector(1024)`、cosine HNSW、会话级检索参数、`FOR UPDATE SKIP LOCKED`、部分索引、动态 schema 限定符和多表事务发布。
- 稳定版 Prisma 无法把上述能力全部表达为普通模型操作；即使引入 Prisma，向量检索、任务领取、索引和关键事务仍需要自定义 migration 与原生 SQL。
- 当前继续使用 `pg` 与显式 SQL，可让一套 migration 和事务模型保持权威。只有常规关系 CRUD 明显增长、且迁移收益足以覆盖双栈成本时，才重新评估 Prisma。

## 模型与 Agent 边界

- OpenRouter `qwen/qwen3-embedding-8b` 固定输出 1024 维，文档批次最多 64；只有查询添加英文检索指令。
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

可选执行报告以一次 `rag-answer` 或 `knowledge-ingestion` 为边界，在运行结束后生成一份本地 Markdown。问答报告关联知识库、会话和 `rag_run`，记录 embedding、检索、模型生成、引用纠正/校验以及审计状态；入库报告关联 job、文档和 revision，记录 LangGraph 各节点、embedding 用量、发布与失败重试信息。后续工作流复用同一个 step/model/tool/finish 接口，无需依赖 LangChain、LangGraph 或 DeepAgents 的内部事件格式。

该报告不是 PostgreSQL 权威审计的替代品，也不参与客户端进度卡片、HTTP 响应或恢复机制。功能关闭时使用 no-op recorder，不创建目录或序列化上下文；写文件失败只产生脱敏 warning，不能改变原始业务结果。报告在执行结束时一次性写入，因此不提供实时遥测。

默认报告只包含安全元数据。上下文、工具正文、最终输出和 reasoning 分别由显式 `.env` 开关保护；密钥、密码、认证头、Cookie、数据库连接信息和向量在任何模式下都不得写入。各可选章节限制为 120,000 字符，报告目录由 Git 忽略且不自动清理。

## 配置与安全

- `apps/api/.env` 是 API 唯一配置来源，不与系统环境变量合并，也不提供隐式默认值。
- 数据库 migration 与 LangGraph `setup()` 只由显式 `pnpm --filter @echowave/api migrate` 执行。
- `EXPO_PUBLIC_API_URL` 会进入客户端 bundle，不得放置密钥。
- API 默认不记录完整正文、完整模型上下文、provider 原始错误或 reasoning；本地诊断内容只能通过显式开关启用，密钥始终禁止记录。
- Redis 仍是未来缓存/协调边界，不参与首期 RAG，也不能成为第二业务真相源。
