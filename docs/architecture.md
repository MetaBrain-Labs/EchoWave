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

## 模型与 Agent 边界

- OpenRouter `qwen/qwen3-embedding-8b` 固定输出 1024 维，文档批次最多 64；只有查询添加英文检索指令。
- 检索使用 cosine HNSW、`ef_search=100` 和 pgvector iterative scan，初召回 30，去重和文档配额后最多向 Agent 提供 8 块/12000 字符。
- DeepAgent 使用 DeepSeek `deepseek-v4-flash`、结构化 `{ answer, grounded, citedChunkIds }` 输出和 PostgreSQL checkpointer。
- 文件系统权限全部拒绝，不配置 skills、长期记忆或子代理；业务工具只有租户范围内的 `search_knowledge`，每次最多调用两次。
- 服务端只接受本次检索白名单中的 chunk ID。依据不足返回 `grounded=false`，不使用常识补答。

## 配置与安全

- `apps/api/.env` 是 API 唯一配置来源，不与系统环境变量合并，也不提供隐式默认值。
- 数据库 migration 与 LangGraph `setup()` 只由显式 `pnpm --filter @echowave/api migrate` 执行。
- `EXPO_PUBLIC_API_URL` 会进入客户端 bundle，不得放置密钥。
- API 不记录完整正文、完整模型上下文、密钥、provider 原始错误或思维链。
- Redis 仍是未来缓存/协调边界，不参与首期 RAG，也不能成为第二业务真相源。
