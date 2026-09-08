# Android 真机全量回归

EchoWave 使用 Codex + Maestro 在一台通过 ADB 连接（USB 或 Android 无线调试）的 Android 真机上执行可重复回归。稳定套件覆盖本地可控的 UI 与 CRUD；真实套件显式调用当前开发后端配置的 ASR、后置分析、业务分析、对象存储和知识库模型，可能产生真实费用。

设备 E2E 不属于 `pnpm check`。没有真机、Android Platform Tools、Maestro 或供应商凭据时，普通开发验证不会被阻塞。

## 一次性准备

1. 安装 Node.js 24、pnpm 11.3、Java 17 或更高版本、Android Platform Tools 和 Maestro CLI。Windows 使用 Maestro 的原生安装方式，不依赖 WSL。编排器只报告缺失项，不安装或修改系统工具。
2. 在手机上启用 USB 调试或 Android 无线调试，完成授权并解锁设备。回归时只能连接一台 `adb devices` 状态为 `device` 的设备。
3. 从 `apps/mobile` 构建并安装专用 Development Build：

   ```powershell
   Set-Location apps/mobile
   pnpm dlx eas-cli@latest build --platform android --profile e2e
   ```

   `e2e` profile 保持应用 ID `com.echowave.app`、现有 EAS 项目与 Firebase 配置不变，并强制显示服务器选择流程。

4. 配置 `apps/api/.env`。稳定套件要求当前音频运行模式为 `hybrid`，但不会修改租户的 Provider、Credential、能力绑定或运行模式。真实套件还要求 PostgreSQL、DashScope、OSS、DeepSeek、FFmpeg 与 VAD 均可用。
5. 保留测试音频：
   `apps/api/.data/audio/74f0d9e3-1adc-4d35-8737-215558532046.mp3`。

## 命令

所有命令均从仓库根目录运行：

```powershell
pnpm e2e:android:preflight
pnpm e2e:android
pnpm e2e:android:real
pnpm e2e:android:showcase
pnpm e2e:android:full
```

- `e2e:android:preflight` 只检查 Java、Maestro、ADB、唯一设备、已安装 App、fixture、API 和 Metro。API/Metro 未运行仅为提示，因为测试命令会按需启动它们。
- `e2e:android` 执行稳定套件，不调用完整模型分析。
- `e2e:android:real` 是产生外部调用与费用的显式入口，最长等待单个完整音频链路 20 分钟。
- `e2e:android:showcase` 使用公开展示名称，按用户故事录制引导、工作区分析、知识库 RAG、可靠性和资源生命周期；它同样会产生真实模型调用与费用。
- `e2e:android:full` 先执行 `pnpm check`，再依次执行稳定与真实 Flow。

修复某个 Flow 后，可以从该 Flow 开始一次新的运行；例如跳过已经通过的首个稳定 Flow：

```powershell
pnpm e2e:android -- --from 02-resource-crud
```

`--from` 使用 Flow 文件名（不含 `.yaml`）。它仍会创建新的 RUN_ID，执行 migration、幂等 seed、服务与设备准备，并让目标 Flow 运行公共启动子流程；仅跳过目标之前的 Flow，不会复用旧运行中未清理的业务资源。

编排器运行 migration 和现有幂等 `seed:dev`，读取 `apps/api/.env` 的 `PORT`，通过 `adb reverse` 将设备的 API 端口与 8081 端口转发到开发机，并把音频与小型 Markdown fixture 精确复制到设备 Download 目录。健康的 API/Metro 会被复用；否则以隐藏子进程启动，失败、正常结束或 Ctrl+C 时只停止本次启动的进程树，不会按端口误杀外部服务。首个 Flow 不依赖 Android `pm clear`，只加载 Expo Development Client 的 Metro URL；应用加载完成后，连接子流程仅在确实显示服务器连接页时填写地址，避免用不支持冷启动的应用内深链打开连接页。

当前编排器是 `adb reverse` 模式：设备端应使用 `127.0.0.1:<端口>`，不应手动在 Expo 启动器中填写 `192.168.1.7:8081`。Metro 以 `--lan` 启动以确保开发机的 IPv4 回环端点实际监听，但设备仍只通过反向隧道访问 `127.0.0.1:8081`；readiness 也只验证这个实际传输端点，不会用可能解析到 IPv6 的 `localhost` 代替。若改为纯局域网模式，还必须让 API 监听局域网接口、在 Windows 防火墙放行对应端口，并调整 Flow 使用的 Metro/API 地址。

## Flow 稳定性约定

所有顶层稳定、真实与 Showcase Flow 都先执行 `.maestro/subflows/prepare-e2e-app.yaml`。公共准备流程负责加载 Development Build、按需连接 API、等待基础引导状态完成异步恢复，并在首次运行时跳过基础引导，最终统一回到分组主页。引导专项 Flow 通过引导中心显式重播目标引导，不依赖首次安装状态。

Maestro 的 `id` 选择器只用于 React Native `testID`。唯一且稳定的 `accessibilityLabel` 使用文本选择器；底部导航、页面页签、图标按钮、重复操作和动态列表入口使用专用 `testID` 或包含运行 ID 的可访问名称。输入框完成最后一次输入后必须先关闭软键盘，再点击测试、搜索或保存按钮。异步页面使用可见状态等待，需要滚动的操作使用 `scrollUntilVisible`，不以固定休眠掩盖时序或布局问题。

## 覆盖与数据边界

稳定 Flow 位于 `.maestro/flows/stable`，覆盖首次服务器连接、五个主区域、关键状态页、分组/知识库/数据源创建与关联、音频选择和播放、三个音频菜单动作、固定 seed 分析详情、错误服务器、前后台/冷启动及明确的“功能建设中”占位。

真实 Flow 位于 `.maestro/flows/real`，覆盖固定 MP3 的上传、ASR、说话人/时间戳、情绪与角色后置分析、业务分析、报告发布；还会上传 `.maestro/fixtures/echowave-e2e-knowledge.md`，等待解析与 Embedding，并验证回答包含可打开引用。推送检查根据服务端能力展示降级状态或设备登记状态，不发送真实推送。

Showcase Flow 位于 `.maestro/flows/showcase`，将同一组核心能力组织成五段可公开演示的用户故事，并在分析就绪、处理中、完成、转写、分析任务、总结、模型详情、RAG 回答、引用原文、设置关联与归档等节点截图。设备端音频和知识文档名称由 runner 参数化，画面不使用运行 ID 命名业务资源。

每次运行使用严格格式的 ASCII ID（例如 `E2E_20260906T010203Z_A1B2C3`）。成功后，清理器只归档或删除 `context.json` 记录且名称完全相等的分组、数据源、音频和知识库；不会按 `E2E_` 前缀批量清理。Flow 与清理状态分别记录；清理失败会保留请求阶段、方法、去敏 URL、底层原因、已完成操作和部分 `cleanup.json`，不会被误报成 Flow 断言失败。Flow 失败时不清理，以保留现场。`seed:dev` 会把固定演示记录恢复到 seed 定义状态，这是使用现有开发后端的已知影响。

当前产品只支持音频文件上传分析，没有真实麦克风录音能力，因此套件不会虚构录音权限测试。

## Showcase 视频渲染

Showcase 或既有 stable 运行完成后，可以生成 150 秒、1920×1080、30fps 的中英双语审阅版：

```powershell
pnpm showcase:video -- --run E2E_20260906T010203Z_A1B2C3 --prepare-tools
```

渲染器从 `commands.json` 生成剪辑时间参考，优先选择 Showcase 截图并在缺失时标记 stable 降级素材；它输出主成片、无旁白 clean 版、中文神经 TTS、独立音乐与音效、ASS 字幕、视频脚本、缩略图、manifest 和 QA 报告到 `.artifacts/showcase-video/<run-id>/`。Windows 受限环境可以先生成计划，再使用 `scripts/showcase/render-video-from-plan.ps1` 渲染；`--mask-overlay` / `-MaskOverlay` 只用于现有素材的已知浮动调试按钮，正式 Showcase 录制仍应在预览检查时关闭覆盖物。

## 报告、诊断与修复门禁

证据保存在 `.artifacts/maestro/<runId>/`，包括运行上下文、健康状态、逐 Flow JUnit、HTML 汇总、截图、录像、commands JSON、Maestro 控制台与内部日志、API/Metro 日志以及仅覆盖本次运行时间的 logcat。若复用既有 API/Metro，相应日志文件会注明无法捕获其历史输出。

Flow 失败后会自动以 `read-only` sandbox 运行临时 `codex exec`。诊断固定输出 `triage.json` 与 `triage.md`，分类为应用、测试 Flow、后端、外部供应商、设备或环境问题。它只能分析证据并提出最小方案，不能编辑源码、弱化断言或跳过失败 Flow。

可以重新诊断已保留现场：

```powershell
pnpm e2e:android:triage -- --run E2E_20260906T010203Z_A1B2C3
```

只有审阅报告后，用户显式提供两个完全相同的运行 ID，才会启动 `workspace-write` Codex：

```powershell
pnpm e2e:android:repair -- --run E2E_20260906T010203Z_A1B2C3 --confirm E2E_20260906T010203Z_A1B2C3
```

repair 必须保留脏工作树，只修复已确认的最小根因，先重跑失败 Flow 与对应分组；源码有修改时按仓库规则执行一次格式化、`git diff --check` 和最终 `pnpm check`。运行 ID 缺失、格式不合法、不完全匹配或没有 `triage.json` 时，repair 会拒绝执行。

## 真机验收

首次接入新设备或 Android 系统版本时，先执行前置检查和单个稳定 Flow，校正 DocumentsUI 在该设备上的“下载”入口或文件名可访问性，然后完成以下门禁：

- 稳定套件连续通过两次，第二次不依赖第一次的业务数据。
- 真实套件至少完整通过一次。
- 人为使用错误服务器和失败断言，确认 artifacts 完整、只读 Codex 分类合理且没有源码改动。
- 在专用测试缺陷上验证带精确确认 ID 的 repair、相关 Flow 复测和根级检查。

相关官方资料：

- [Maestro CLI 安装](https://docs.maestro.dev/maestro-cli/how-to-install-maestro-cli)
- [React Native 集成](https://docs.maestro.dev/platform-support/react-native)
- [`addMedia` 支持格式](https://docs.maestro.dev/reference/commands-available/addmedia)（不含音频，因此本方案使用 `adb push`）
- [测试报告与 artifacts](https://docs.maestro.dev/troubleshooting/debug-output)
- [Codex 非交互模式](https://learn.chatgpt.com/docs/non-interactive-mode)
