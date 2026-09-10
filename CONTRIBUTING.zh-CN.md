# 为 EchoWave 做贡献

[English](./CONTRIBUTING.md) | **简体中文**

感谢你关注 EchoWave。项目当前处于开发预览阶段，欢迎提交可复现的问题、边界清晰的功能建议、文档改进和经过验证的代码变更。

## 开始之前

1. 阅读根目录 [README](./README.md)、[文档索引](./docs/README.md)和与改动相关的专题文档。
2. 搜索现有 [Issues](https://github.com/MetaBrain-Labs/EchoWave/issues)，避免重复工作。
3. 对跨层功能、数据库迁移、公开契约、Provider 接入或大范围重构，先创建 Issue 描述目标和方案，等待范围达成共识后再实现。
4. 安全问题不要创建包含复现细节的公开 Issue，请遵循[安全策略](./SECURITY.md)。

## 开发环境

仓库要求 Node.js `24.x`、pnpm `11.3.0`，并使用 pnpm workspace 与 Turborepo。不要使用 npm 或 Yarn 修改依赖和锁文件。

```bash
git clone https://github.com/MetaBrain-Labs/EchoWave.git
cd EchoWave
pnpm install --frozen-lockfile
cp apps/api/.env.example apps/api/.env
cp apps/mobile/.env.example apps/mobile/.env
pnpm --filter @echowave/api migrate
pnpm start
```

Windows 请用 `Copy-Item` 替代 `cp`。完整配置、PostgreSQL/pgvector、FFmpeg、Development Build 和局域网地址要求见 [README](./README.md) 与[配置指南](./docs/configuration.md)。

## 变更约束

- 保持修改聚焦，一个 Pull Request 解决一个明确问题；不要顺带重构无关代码。
- API 与 App 的网络 wire shape 必须先在 `packages/contracts` 中定义和运行时校验。
- PostgreSQL 是业务事实的权威来源；数据库变化使用有序 SQL migration，不直接改写历史 migration。
- 保持音频转写与分析的版本、来源、幂等、重试、取消和下游失效语义。
- 移动端继续使用 Expo Router、React Native primitives、`StyleSheet` 和共享设计令牌。
- 新增用户文案同时维护简体中文和英文目录；模型使用的英文 prompt/工具描述中不要混入中文说明。
- 不提交 `.env`、Credential、Keystore、Firebase 服务账号、运行时数据、构建产物或真实用户内容。
- 人维护的 `.ts`/`.tsx` 文件需要符合仓库既有的简体中文 JSDoc 文件头与关键边界注释约定。

详细工程边界以仓库根目录 `AGENTS.md` 为准；它主要面向工程 Agent，但其中的架构、文档与验证约束也适用于人工贡献。

## 验证

完成一批源代码变更后，从仓库根目录运行一次格式化，再按影响范围验证：

```bash
pnpm format
pnpm docs:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm check
git diff --check
```

请不要重复运行会改写文件的格式化命令。纯文档变更至少运行 `pnpm docs:check` 和 `git diff --check`；涉及运行逻辑的变更先运行最小相关测试，再以 `pnpm check` 作为最终门禁。移动端行为变化如具备 Android 设备和工具，再运行最窄的 Maestro Flow；设备 E2E 不属于常规 `pnpm check`。

## 提交 Issue

Bug 报告应包含：

- 使用路径、期望结果与实际结果。
- 操作系统、客户端平台、Node/pnpm 版本和部署方式。
- 最小复现步骤，以及经过脱敏的错误码或日志片段。
- 是否可以稳定复现，是否涉及真实 Provider 调用。

功能建议应先说明用户问题、目标用户、成功标准与明确非目标。涉及 AI Provider 时还应说明区域可用性、费用、生命周期和所需输出契约。

## 提交 Pull Request

- 从最新默认分支创建主题分支，使用清晰的提交信息。
- 在 PR 中说明“改了什么、为什么、如何验证、未能验证什么、剩余风险”。
- 关联对应 Issue，并为用户可见变化同步更新 README 或专题文档。
- 公开契约变化需要覆盖有效与拒绝载荷；Bug 修复需要覆盖触发问题的失败或边界场景。
- 不降低断言、关闭测试或用任意等待掩盖回归。

维护者可能要求缩小范围、补充测试或拆分 PR。贡献一经提交，即按仓库的 [Apache License 2.0](./LICENSE) 条款提供。
