# 一键式音频全流程分析

“新建”页可以把 1–20 个新文件或已有音频放入同一批次。批次固定一个数据源和一个分组；上传和音频校验立即执行，`scheduledFor` 只控制 ASR、情绪、角色与业务分析何时可领取。

## 模式边界

- 对象存储：支持立即、批量、定时和完整恢复，上传使用预签名 PUT。
- 混合存储：支持立即、批量、定时和完整恢复，要求持久化 `AUDIO_STORAGE_DIR` 且当前保持单 API 实例。
- 轻量本地：支持立即批量，不接受未来时间。音频依赖阶段硬阻塞时源文件保留 24 小时；过期后必须重新选择 SHA-256 和字节数相同的文件。

PostgreSQL 的 `audio_analysis_batches` 和 `audio_analysis_tasks` 是状态唯一来源。Worker 使用 `FOR UPDATE SKIP LOCKED`、`LISTEN/NOTIFY` 和 15 秒补偿扫描，按 `ASR → system_raw_snapshot → 情绪与角色 → 业务分析` 推进。情绪或角色永久失败会成为业务报告限制并产生 `completed_with_warnings`；ASR 或业务分析永久失败不会发布伪成功。

## 恢复和取消

网络异常、普通 429 和 5xx 由各阶段 Worker 的既有退避与 checkpoint 恢复。只有供应商明确返回余额/额度耗尽、凭据失效或配置缺失时，任务进入 `hard_blocked`。同一批次首次能力阻塞会暂停尚未调用该能力的任务，恢复时只刷新未完成阶段的能力 revision，已经完成的结果不变。

取消尚未开始的任务会立即结束；外部调用已经提交时只设置 `cancel_requested`，等待当前调用收敛后停止后续阶段。

## 推送部署

App 使用 `expo-notifications`，API 使用 `expo-server-sdk` 和 PostgreSQL outbox。仅发送 `HARD_BLOCKED / FAILED / COMPLETED / PARTIAL_COMPLETED`，通知数据只包含 `type、batchId、taskId`，点击后重新读取批次状态。

远程推送必须使用 Android/iOS Development Build，不能依赖 Expo Go。EAS 项目需要提供 `projectId`；启用 Expo access-token 安全时，在 `apps/api/.env` 设置 `EXPO_PUSH_ACCESS_TOKEN`。部署前还要验证服务器能够访问 `exp.host`。发送 Worker 会退避网络、429 和 5xx，检查 receipt，并在 `DeviceNotRegistered` 时停用 Token。
