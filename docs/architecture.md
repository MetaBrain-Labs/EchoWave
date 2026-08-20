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

## 数据与发布边界

- PostgreSQL 是知识库、文档、revision、chunk、任务、会话和运行记录的权威来源。
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
- 文件系统权限全部拒绝，不配置 skills、长期记忆或子代理；业务工具只有租户范围内的 `search_knowledge`，每次最多调用两次。
- 服务端只接受本次检索白名单中的 chunk ID。依据不足返回 `grounded=false`，不使用常识补答。

### 为什么问知识库暂不流式返回

可信回答模块必须先完成 `DeepAgent invoke → JSON 恢复或纠正 → citation 白名单校验 → usage 汇总 → run 审计完成`，之后 Hono 才返回一个通过 `RagQueryResponseSchema` 校验的 JSON。移动端同样在完整 body 到达后统一解析和渲染。

这不是 LangGraph 或 Hono 缺少流式能力，而是当前网络契约只承诺最终已验证结果。逐 token 输出需要新增产品级事件契约，区分临时文本、最终引用、用量、取消和失败，并处理“已展示文本后来被引用校验否决”的一致性问题；该协议应作为独立功能设计，不能通过简单替换 `invoke` 绕过可信性校验。

## 配置与安全

- `apps/api/.env` 是 API 唯一配置来源，不与系统环境变量合并，也不提供隐式默认值。
- 数据库 migration 与 LangGraph `setup()` 只由显式 `pnpm --filter @echowave/api migrate` 执行。
- `EXPO_PUBLIC_API_URL` 会进入客户端 bundle，不得放置密钥。
- API 不记录完整正文、完整模型上下文、密钥、provider 原始错误或思维链。
- Redis 仍是未来缓存/协调边界，不参与首期 RAG，也不能成为第二业务真相源。
