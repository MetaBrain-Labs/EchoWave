# 音频运行模式

[English](./audio-runtime-modes.md) | **简体中文**

EchoWave 以租户为单位提供三种音频运行模式。模式切换只影响切换后创建的 `AudioAsset`；每条资产在创建时固化模式、存储后端、存储绑定 revision 和清理期限，已有资产不会被隐式迁移或删除。

## 部署时如何选择

| 模式                         | 原音频保存位置                                                  | OSS                | 恢复与重跑                                            | 推荐用户                             |
| ---------------------------- | --------------------------------------------------------------- | ------------------ | ----------------------------------------------------- | ------------------------------------ |
| 轻量本地 `lightweight_local` | API 临时目录，成功或到期后清理                                  | 不需要             | 清理后重新转写必须重新选择 SHA-256 和大小相同的原文件 | 首次试用、低存储成本、不长期保留音频 |
| 混合 `hybrid`                | API 的 `AUDIO_STORAGE_DIR`；Docker 中为 `echowave_audio` volume | 仅 `audio_staging` | 原音频存在时可播放并重新执行音频依赖流程              | 默认选择、本地长期保留原音频         |
| 对象存储 `object_storage`    | `audio_primary_storage` OSS                                     | 主存储和中转都需要 | 保留期内可按 OSS 原件恢复；过期后历史结果仍保留       | 音频量较大、需要对象存储生命周期管理 |

三种模式都支持异步处理：只有上传完成并成功创建/提交服务端任务后，用户才可以关闭 App，由服务端继续在后台处理。区别不在能不能异步，而在原音频保存在哪里，以及服务器异常、重启、迁移之后能恢复到什么程度。

三种模式的成本与恢复定位如下：

- 轻量本地 = 异步处理 + 临时本地存储 = 成本最低 / 恢复能力最低。
- 混合模式 = 异步处理 + 持久本地存储 + OSS 中转 = 默认方案 / 成本和可靠性平衡。
- 对象存储 = 异步处理 + OSS 持久存储 = 云部署 / 大规模 / 恢复能力最好。

唯一需要特别注意的边界是：如果在音频还没有上传完成时直接杀掉 App，三种模式都不能理解为服务端已经接管。只有完成上传并成功创建/提交服务端任务之后，App 生命周期才与后台任务生命周期解耦。

三种模式都需要 PostgreSQL、FFmpeg/VAD 和 DashScope 音频能力。角色、知识问答及业务分析还需要 DeepSeek 逻辑连接。混合与对象存储模式必须先完成相应 OSS 能力绑定；轻量本地可以在没有 OSS 的情况下工作。

不确定时先选轻量本地进行功能试用，确认需要长期播放或重跑原音频后改为混合；已经有规范 OSS 生命周期和备份策略时再选择对象存储。切换模式不会迁移已有音频，不能把切换当成存储迁移工具。安装与 Provider 配置步骤见[Server 部署指南](./server-deployment.zh-CN.md)。

## 模式

### 混合存储 `hybrid`

默认且兼容原有行为。原音频长期保存在 API 的 `AUDIO_STORAGE_DIR`，FFmpeg/VAD 产物通过 `audio_staging` OSS 短期中转给 DashScope。声学情绪仍由用户在 Transcript 确认后独立启动。

### 对象存储 `object_storage`

移动端通过预签名 PUT 把原音频直接上传到 `audio_primary_storage` OSS。API 只在校验、ASR 预处理和声学窗口生成时流式落入受控临时目录，任务结束后删除，不保存长期本地副本。原音频由租户保留策略决定是否长期保存；到期后历史 Transcript 和情绪结果保留，但不能重新执行声学情绪。`/api/audio-files/:id/content` 使用稳定地址代理 OSS Range。

### 轻量本地 `lightweight_local`

移动端以二进制流把原音频复制到 API 临时音频目录。首次上传和每次手动重转写都提供“同时进行声学情绪分析”开关，默认开启：

- 开启：`VAD → ASR → Transcript 发布 → 声学情绪 → 清理`。
- 关闭：`VAD → ASR → Transcript 发布 → 清理`，该 ASR revision 的情绪状态永久为 `not_requested`，不能稍后补跑。

声学分析必须使用本次 Raw Transcript 的原始时间戳切取音频窗口，因此内部顺序执行，不与 ASR Provider 调用并行。清理后播放器显示“源音频未保留”。若需要创建新 Run，用户必须重新选择原文件；API 以创建资产时保存的 SHA-256 和字节数校验一致性。

## 权威数据与恢复

PostgreSQL 保存 Transcript、VAD Manifest、ASR Run、Provider 任务 ID、Checkpoint、确认版本、情绪/角色结果和业务分析。对象存储和本地目录只保存音频二进制及短期中间文件，不保存重复 Transcript JSON，也不生成 `finish` 音频。

服务重启时，PostgreSQL 中的批次、任务和 Checkpoint 会继续驱动后台处理；能否恢复依赖原音频所在位置仍然可用。轻量本地的临时目录丢失或到期后只能保留已发布结果，音频依赖阶段需要重新挂载原文件；混合模式迁移或重启时必须同时保留并重新挂载 `AUDIO_STORAGE_DIR`；对象存储模式只要 PostgreSQL、OSS 绑定和原件仍可访问，最适合跨主机迁移与大规模恢复。

ASR revision 的 Checkpoint 顺序为：

`source_validated → preprocessing_ready → provider_staged → provider_submitted → provider_terminal → transcript_published → acoustic_emotion_completed → cleanup_completed`

Provider 任务 ID 和终态先写入 PostgreSQL，进程恢复时不会重复提交已存在的 Provider 任务。Transcript 已发布时只继续声学情绪或清理。轻量模式最终失败的源文件最多保留至最后失败后 24 小时；服务启动时及每 15 分钟执行一次到期清理补偿。

## 配置与接口

“更多”页提供“服务状态 / AI 配置 / 运行模式”三个入口。运行模式公开可查看，修改必须提交 `CONFIGURATION_ADMIN_TOKEN`。启用对象模式要求 `audio_primary_storage`、`audio_staging`、DashScope ASR、FFmpeg 和 VAD 就绪；启用轻量模式要求 DashScope ASR/声学情绪、FFmpeg 和 VAD 就绪。

主要接口：

- `GET /api/audio-runtime`
- `PUT /api/settings/audio-runtime`
- `POST /api/data-sources/:id/audio-upload-sessions`
- `PUT /api/audio-upload-sessions/:id/content`
- `POST /api/audio-upload-sessions/:id/complete`
- `GET /api/audio-files/:id/transcriptions`
- `PUT /api/audio-files/:id/transcript-selection`
- `PUT /api/audio-files/:id/source-remount`

手动选择旧 ASR Run 后，后续新 Run 成功不会覆盖选择；恢复 `auto` 后使用最新成功 revision。
