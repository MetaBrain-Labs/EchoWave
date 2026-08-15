# EchoWave 架构说明

## 当前纵切片

EchoWave 使用 pnpm workspace 管理两个应用和一个内部包，Turborepo 负责任务编排与缓存。

```text
Expo mobile ── GET /api/hello ──> Hono API
      │                              │
      └──── @echowave/contracts ─────┘
```

`@echowave/contracts` 是网络契约的唯一权威来源。API 使用 schema 构造响应，客户端在使用数据前再次进行运行时解析，避免 TypeScript 类型掩盖不可信网络数据。

移动端示例卡片是展示层常量，不会写入 AsyncStorage、浏览器存储或服务端，也不代表未来持久化模型。

## 包职责

- `apps/mobile`：路由、跨平台交互、展示状态、API 客户端和客户端响应校验。
- `apps/api`：HTTP 传输、环境变量校验、CORS、错误映射和进程生命周期。
- `packages/contracts`：跨应用共享的 Zod schema 与由 schema 推导的 TypeScript 类型。

## PostgreSQL 与 Redis 的后续边界

本里程碑不安装 Prisma、PostgreSQL 驱动、Redis 客户端或队列组件，也不提供 Docker Compose。API 只从自身目录的 `.env` 读取并校验 `POSTGRES_*` 和 `REDIS_*` 分字段配置，不合并进程环境或提供默认值；这些字段会形成后续数据层使用的稳定配置对象，但当前不会建立网络连接。

后续引入持久化时遵循以下边界：

1. PostgreSQL 作为业务实体、任务状态和来源元数据的权威存储。
2. Redis 只承担确有必要的缓存、短期协调或队列职责，不成为业务数据的第二权威来源。
3. 数据访问模块位于 API 的基础设施层，HTTP 路由不直接调用数据库客户端。
4. 数据库 schema、迁移、生成客户端、生产者与消费者必须在同一变更中验证。
5. 上传与分析任务需要明确的幂等键、重试策略、生命周期状态和中断恢复行为后再接入队列。

## 配置与安全

- `EXPO_PUBLIC_API_URL` 会进入客户端 bundle，因此不得放置任何密钥。
- `CORS_ORIGINS` 是逗号分隔的允许来源；生产环境不得沿用未审核的本地来源。
- API 错误响应保持精简，不向客户端泄露堆栈、环境变量或内部依赖错误。
- `.env`、`.env.local`、构建产物、测试覆盖率与工具缓存均被 Git 忽略。
