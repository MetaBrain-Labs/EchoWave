# Android E2E 问题汇总与排障记录

[English](./mobile-e2e-troubleshooting.md) | **简体中文**

本文汇总 EchoWave 使用 Codex + Maestro 在 Windows、Android 真机和开发后端执行回归时出现过的问题。它记录的是排障结论与当前约束，不替代 [Android 真机全量回归](./mobile-e2e.md) 的完整运行说明。

## 先看结论

- `Seeded EchoWave audio workspace development data.` 是 seed 成功日志，不是失败原因。真正的失败通常发生在后续 Maestro Flow；应继续查看 `.artifacts/maestro/<runId>/summary.json`、Flow 目录下的 `commands.json`、截图和屏幕层级文件。
- 当前 E2E 编排器使用 `adb reverse`。真机访问 Metro/API 时使用 `127.0.0.1` 加端口，不应在 Expo Development Client 中手动填写 `192.168.1.7:8081`。
- API 端口读取 `apps/api/.env` 的 `PORT`；本次运行中实际使用过 `3201`，不能假定一直是 `3001`。
- `--from` 会创建新的运行 ID，但不会执行被跳过 Flow 创建的业务资源。一个 Flow 如果引用动态 `${SOURCE_NAME}`、`${GROUP_NAME}`，就必须先保证资源由本 Flow 创建，或改用 seed 数据。
- 失败、正常结束和 Ctrl+C 都应只清理本次启动的 API、Metro 和日志进程树。当前实现已经增加进程树清理和 SIGINT/SIGTERM 处理，3201/8081 在最近一次失败后均已释放。

## 问题分类

| 阶段           | 代表现象                                                                      | 根因判断                                                                         | 处理结果                                                                                           |
| -------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 设备前置检查   | `唯一已授权 Android 设备: 无设备`                                             | ADB 未发现设备，或无线调试尚未连接/授权                                          | 改用 Android 无线调试，并要求 `adb devices` 只有一个 `device`                                      |
| 设备前置检查   | 同时出现 `192.168.1.12:39743:device` 和 `adb-..._adb-tls-connect._tcp:device` | 同一真机被 ADB 以两个无线端点登记，违反“唯一设备”约束                            | 断开多余端点后重新检查，不能让编排器猜选设备                                                       |
| 设备前置检查   | API/Metro 显示 `WARN: 未运行`                                                 | 前置检查只提示服务状态；执行套件时会按需启动                                     | 不是失败原因                                                                                       |
| 数据库迁移     | `relation "tenants" already exists`，错误码 `42P07`                           | 数据库已有表，但迁移再次执行了非幂等建表语句，通常是迁移状态与实际 schema 不一致 | 后续迁移逻辑完成后，`migrate` 可通过；不要把重复建表误判成 Maestro 问题                            |
| seed           | `column "transcript_segment_id" ... does not exist`，错误码 `42703`           | seed 使用了新字段，而当前数据库迁移尚未创建该字段，存在 schema/seed 漂移         | 修正迁移顺序或字段后，`seed:dev` 输出成功                                                          |
| seed 后        | 只看到 `Seeded EchoWave...`，随后 `E2E 失败`                                  | seed 已成功，失败发生在 Maestro Flow 的 UI 步骤                                  | 以 Flow artifact 中的失败步骤为准，不要只看控制台最后一行                                          |
| Flow 01        | 真机连接页显示 `unexpected end of stream`，堆栈指向 `http://127.0.0.1:8081`   | Metro 端点尚未就绪、连接地址与传输方式不一致，或旧进程中途关闭连接               | 使用 `adb reverse` 的 127.0.0.1 端点；等待 Metro readiness；不要把 LAN 地址填入当前 reverse 模式   |
| Flow 01        | 已输入服务器地址，点击测试连接后没有后续                                      | Flow 的地址/端口或等待条件与实际页面状态不一致                                   | 使用 `.env` 实际 API 端口（例如 `3201`），连接子流程只在确实显示连接页时操作，并保留截图/层级证据  |
| 引导/资源 Flow | 页面已进入但 Maestro 报元素找不到                                             | 真机滚动位置、输入法、MIUI 系统弹窗或异步加载导致 UI 与固定步骤偏移              | 使用稳定 `testID`、`extendedWaitUntil`、`scrollUntilVisible`；不使用固定 sleep 掩盖问题            |
| 搜索抽屉       | 输入法出现后遮挡搜索框和按钮                                                  | 透明 Modal 内部没有对 Android 键盘启用避让                                       | `SearchSheet` 原生端统一使用 `KeyboardAvoidingView` 的 `padding` 行为；Flow 保持键盘显示并截图验证 |
| 系统文件选择器 | 音频/文档选择后停在 DocumentsUI 或找不到确认按钮                              | 不同 Android/MIUI provider 使用 `确定`、`OK` 或 `Open` 等不同文本                | 公共选择器子流程兼容这些按钮；音频通过 `adb push` 放入 Download，不使用不支持音频的 `addMedia`     |
| Flow 05        | `Element not found: E2E_A6C9B4_SOURCE`                                        | 从 `--from 05` 启动时跳过了创建动态数据源的 Flow 02，`${SOURCE_NAME}` 不存在     | 改为向上滚动后选择 seed 的「市场调研资料」和「市场洞察组」，使 Flow 05 可独立运行                  |
| 进程清理       | 失败或 Ctrl+C 后 3201/8081 仍被占用                                           | 旧实现因 PowerShell 包装进程已退出而提前跳过子进程清理，也没有统一处理中断信号   | 递归清理本次启动的完整进程树；失败前先清理，SIGINT/SIGTERM 也清理；不按端口误杀外部服务            |
| 诊断重跑       | Codex 侧出现 `spawnSync powershell.exe EPERM`                                 | 当前受限 Codex 沙箱禁止 Node 再启动 PowerShell，未进入真机 Flow                  | 归类为本地环境限制，不代表应用失败；在用户本机 PowerShell 执行相同命令                             |

## 代表性运行记录

以下运行 ID 用于定位现场，完整证据位于对应目录：

- `E2E_20260906T134817.803Z_227EF3`：迁移重复建表，并暴露了带毫秒时间戳的无效运行 ID 提示。
- `E2E_20260906T135630Z_4A261B`：seed 访问不存在的 `transcript_segment_id` 字段。
- `E2E_20260906T140318Z_6F418B`：迁移和 seed 成功，但后续 Flow 失败。
- `E2E_20260906T172514Z_38BDB1`：Flow 01 的 Metro/连接页问题，已生成 `triage.md`。
- `E2E_20260907T124718Z_A6C9B4`：Flow 05 找不到动态数据源名称；失败后 3201/8081 已确认无监听。

常用证据文件：

```text
.artifacts/maestro/<runId>/summary.json
.artifacts/maestro/<runId>/context.json
.artifacts/maestro/<runId>/flows/<flow>/.../commands.json
.artifacts/maestro/<runId>/flows/<flow>/.../screenshots/
.artifacts/maestro/<runId>/flows/<flow>/.../screen-hierarchy/
.artifacts/maestro/<runId>/triage.md
.artifacts/maestro/<runId>/api.log
.artifacts/maestro/<runId>/metro.log
```

## 当前排障流程

1. 执行 `pnpm e2e:android:preflight`，确认 Java、Maestro、ADB、Development Build 和唯一已授权设备。
2. 如果只验证某个已修复 Flow，使用精确文件名启动，例如：

   ```powershell
   pnpm e2e:android -- --from 05-onboarding-validation
   ```

3. 看到 seed 成功后仍失败时，先打开 `summary.json` 和该 Flow 的 `commands.json`，定位具体失败步骤，再看同一步骤的截图和 screen hierarchy。
4. 检查 API 端口时以 `apps/api/.env` 为准；检查 Metro 时确认 8081。不要在当前 reverse 模式下把 `192.168.1.7:8081` 当作 Metro 地址填进 App。
5. 失败现场需要重新分析时运行：

   ```powershell
   pnpm e2e:android:triage -- --run <runId>
   ```

6. 只有审阅 `triage.md` 后，才使用两个完全相同的运行 ID 显式启动修复：

   ```powershell
   pnpm e2e:android:repair -- --run <runId> --confirm <runId>
   ```

## 已完成的验证

- `pnpm e2e:android:test`：E2E 编排器静态回归 19/19 通过。
- `git diff --check`：通过。
- `pnpm check`：在进程清理批次完成时通过；本次 Flow 05 仅为 YAML 和静态测试调整。
- 真机 Flow 05 的最终重跑曾受当前 Codex 沙箱的 `spawnSync powershell.exe EPERM` 阻塞，需要在用户本机 PowerShell 验证。

## 后续风险与边界

- 真实套件会调用当前配置的 ASR、OSS、DeepSeek 和后置分析能力，并可能产生费用；稳定套件不应通过跳过断言来规避真实问题。
- `seed:dev` 会恢复固定演示数据；使用现有开发后端时，这是已知的共享环境影响。
- Flow 失败现场默认保留，便于诊断；成功后只清理 `context.json` 中精确记录的本次资源，不按宽泛前缀清库。
- 当前产品是音频文件上传分析，不包含真实麦克风录音能力，因此没有虚构录音权限测试。
