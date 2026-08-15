# EchoWave

EchoWave 是一个面向音频分析、知识库关联和数据源连接场景的跨平台应用骨架。当前里程碑提供可运行的 Expo 三端界面、Node.js HelloWorld API 与端到端共享响应契约，不包含真实音频处理、鉴权或持久化。

## 技术基线

- Node.js 24
- pnpm 11.3.0
- Turborepo
- Expo SDK 57、React Native 0.86、React 19
- Hono、Zod、TypeScript
- 后续数据层：PostgreSQL、Redis（当前未安装或连接）

## 仓库结构

```text
apps/
  api/       Node.js + Hono API
  mobile/    Expo Router 通用应用（iOS / Android / Web）
packages/
  contracts/ API 与客户端共享的运行时契约
docs/
  architecture.md
```

## 本地启动

### 1. 准备工具链

确认当前 Node.js 主版本为 24，然后启用 Corepack：

```powershell
corepack enable
corepack pnpm@11.3.0 --version
```

### 2. 安装依赖

```powershell
corepack pnpm@11.3.0 install
```

根目录 `packageManager` 和 `pnpm-lock.yaml` 会共同保证可重复安装。

### 3. 配置环境变量

`apps/api/.env` 是 API 的唯一配置来源：启动时会直接读取并校验该文件，不合并系统环境变量，也不使用隐式默认值。移动端由 Expo 自动加载 `apps/mobile/.env.local`。可以分别从两个应用目录内的 `.env.example` 复制：

```dotenv
EXPO_PUBLIC_API_URL=http://localhost:3001
```

API 的 PostgreSQL 与 Redis 配置使用 `POSTGRES_HOST`、`POSTGRES_PORT`、`POSTGRES_USER` 等分字段变量，以及对应的 `REDIS_*` 变量。当前里程碑会读取、规范化并校验这些配置，但不会建立数据库或 Redis 连接。

如果 API 报告端口已被占用，说明已有另一个服务实例监听了 `.env` 中的 `PORT`。停止旧实例，或只在 `apps/api/.env` 中修改 `PORT`，并同步更新移动端的 API 地址。

不同运行环境需要使用不同主机地址：

- Web、iOS Simulator：`http://localhost:3001`
- Android Emulator：通常为 `http://10.0.2.2:3001`
- Android/iOS 真机：使用开发电脑的局域网地址，例如 `http://192.168.1.20:3001`

真机与开发电脑需要处于同一网络，且本机防火墙需要允许 API 端口。若 Expo Web 使用了非 8081 端口，请同步修改 API 的 `CORS_ORIGINS`。

### 4. 启动

同时启动 Expo 与 API：

```powershell
corepack pnpm@11.3.0 dev
```

也可以分开启动，便于操作 Expo 的交互式终端：

```powershell
corepack pnpm@11.3.0 dev:api
corepack pnpm@11.3.0 dev:mobile
```

进入 Expo 终端后，按 `w` 打开 Web，按 `a` 打开 Android。iOS Simulator 需要在 macOS 上运行。

## 可用脚本

```powershell
corepack pnpm@11.3.0 lint
corepack pnpm@11.3.0 typecheck
corepack pnpm@11.3.0 test
corepack pnpm@11.3.0 build
corepack pnpm@11.3.0 check
```

`build` 会编译共享契约与 Node API，并通过 Expo 为 iOS、Android、Web 生成可移植的 JavaScript bundle。该校验命令跳过 Hermes bytecode；正式原生构建仍由未来的 EAS/原生流水线负责。生成目录和本地缓存不会提交到 Git。

## 当前功能

- 分组主界面的音频分析、关联知识库和连接数据源标签
- 音频完成、跨分组、待分析、上传中、分析中状态示例
- 分组、知识库、新建、分析、更多五项导航
- 搜索、筛选、菜单等操作的明确占位反馈
- 更多页中的 API 加载、在线、离线、超时和重试状态
- `GET /api/hello` HelloWorld 接口及共享 Zod 契约

## 当前边界

本里程碑不包含鉴权、真实音频上传或分析、知识库管理、数据源同步、队列、数据库、缓存、部署和 EAS Build。PostgreSQL 与 Redis 的预留原则见 [架构说明](./docs/architecture.md)。

在 Windows 上无法运行 iOS Simulator；iOS 本轮通过 Expo bundle 导出、TypeScript 检查和应用配置校验，最终原生运行验收需在 macOS/Xcode 环境完成。
