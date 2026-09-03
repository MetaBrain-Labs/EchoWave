# 音频运行模式

EchoWave 以租户为单位提供三种音频运行模式。模式切换只影响切换后创建的 `AudioAsset`；每条资产在创建时固化模式、存储后端、存储绑定 revision 和清理期限，已有资产不会被隐式迁移或删除。

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
