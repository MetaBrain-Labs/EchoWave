# 一键式音频全流程分析

“新建”页可以把 1–20 个新文件或已有音频放入同一批次。批次固定一个数据源和一个分组；上传和音频校验立即执行，`scheduledFor` 只控制 ASR、情绪、角色与业务分析何时可领取。

## 模式边界

- 对象存储：支持立即、批量、定时和完整恢复，上传使用预签名 PUT。
- 混合存储：支持立即、批量、定时和完整恢复，要求持久化 `AUDIO_STORAGE_DIR` 且当前保持单 API 实例。
- 轻量本地：支持立即批量，不接受未来时间。音频依赖阶段硬阻塞时源文件保留 24 小时；过期后必须重新选择 SHA-256 和字节数相同的文件。

PostgreSQL 的 `audio_analysis_batches` 和 `audio_analysis_tasks` 是状态唯一来源。Worker 使用 `FOR UPDATE SKIP LOCKED`、`LISTEN/NOTIFY` 和 15 秒补偿扫描，按 `ASR → system_raw_snapshot → 情绪与角色 → 业务分析` 推进。情绪或角色永久失败会成为业务报告限制并产生 `completed_with_warnings`；ASR 或业务分析永久失败不会发布伪成功。

每个任务会为转写、情绪、角色和业务分析记录 `created / reused / skipped / unavailable` 来源。`created` 表示该批次新建了对应任务，`reused` 表示沿用已有 revision 或 job，`skipped` 表示批次配置明确关闭该阶段，`unavailable` 表示依赖结果不存在。迁移前的历史任务没有来源事实，读取时必须显示 `unknown`，不得反推或猜测。

启用 `AI_EXECUTION_REPORT_ENABLED` 后，新批次首次进入最终完成或失败状态时会额外写入一份 `audio-analysis-batch` Markdown 清单。清单记录批次配置、任务终态、各阶段来源、关联 revision/job/run ID、警告与错误；同一批次重复终态不会重复生成。单次 AI execution 报告仍只表示真实模型调用，复用结果不会伪造调用或费用记录。报告写入采用同目录临时文件和原子重命名，失败只输出脱敏诊断，不会改变分析终态。

## 恢复和取消

网络异常、普通 429 和 5xx 由各阶段 Worker 的既有退避与 checkpoint 恢复。只有供应商明确返回余额/额度耗尽、凭据失效或配置缺失时，任务进入 `hard_blocked`。同一批次首次能力阻塞会暂停尚未调用该能力的任务，恢复时只刷新未完成阶段的能力 revision，已经完成的结果不变。

取消尚未开始的任务会立即结束；外部调用已经提交时只设置 `cancel_requested`，等待当前调用收敛后停止后续阶段。

## 推送部署

App 使用 `expo-notifications`，API 使用 `expo-server-sdk` 和 PostgreSQL outbox。仅发送 `HARD_BLOCKED / FAILED / COMPLETED / PARTIAL_COMPLETED`，通知数据只包含 `type、batchId、taskId`，点击后重新读取批次状态。

远程推送必须使用包含通知原生模块的 Development 或 Production Build，不能依赖 Expo Go。仅当 `apps/api/.env` 显式设置 `PUSH_NOTIFICATIONS_ENABLED=true` 时，服务端才启动发送 Worker，并通过 `/health.capabilities.remotePush` 告知 App 请求权限和注册设备；Self-hosted 模板默认为 `false`。App 会在启动、服务器切换和回到前台时串行确认登记，“服务状态”页分别展示服务端能力、系统权限、Token 获取和 API 登记结果，并可手动重新登记。只有成功的 `POST /api/push-devices` 才表示“设备已登记”。

EAS 项目需要提供 `projectId`；启用 Expo access-token 安全时，再设置 `EXPO_PUSH_ACCESS_TOKEN`。部署前还要验证服务器能够访问 `exp.host`。发送 Worker 会退避网络、429 和 5xx，检查 ticket 与 receipt，并在 `DeviceNotRegistered` 时停用 Token。服务端诊断只记录平台、设备 ID、投递阶段、ticket ID 和供应商错误码，不记录 Token、凭据或通知正文。当前仓库记录并验收 Android FCM v1 路径；iOS 还需要 Apple Developer/APNs 凭据和 macOS 原生验收。
