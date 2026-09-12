# EchoWave 宣传片补录素材库

这四条 Flow 仅录制已有真实结果，不创建、编辑、确认、归档或清理业务数据，不启动分析、重试、文档解析或发送知识问题。它们不属于默认 E2E 集合，也不会改变 stable、real、showcase 的含义。补录仅进入 footage library，后续审片会挑选镜头，不保证每条进入成片；本次不修改视频工程。

## 前置条件

- Android 真机已连接，ADB 与 Maestro 可用，安装的 EchoWave appId 为 `com.echowave.app`，界面语言为简体中文。
- 01 / 02 必须运行已包含片段级内容 `testID` 的新版 App。Development Build 需加载最新 JS；使用内置 JS 的安装包需重新构建并安装。先在目标转写页通过 `maestro hierarchy` 确认 `transcript-time-<ID>`、`transcript-emotion-<ID>` 和 `transcript-content-<ID>` 可见，旧版安装包不能运行新版定位脚本。
- 手动启动 App，完成连接；Flow 不启动、重启或清空 App，也不填写服务器地址。执行 01、02、04 前回到有底部导航的分组页面，并将列表回到顶部。
- 使用可公开的真实录音与文档，分组和音频名称必须唯一。01 选两段按时间先后排列、属于不同说话人且都有角色与声学情绪详情的发言。02 必须已有业务分析及两个真实标签；04 必须已有确认版本、已完成后置任务和业务报告。
- 关闭通知、调试菜单及浮动齿轮，固定竖屏，保持正常系统动画。先人工查看预览，存在密钥、私有地址、设备标识、个人隐私或原始提示词时不要录制。截图并不自动脱敏；不要为隐藏结果限制而屏蔽复核警告。
- 选择分析标签时，确认标题、解释和证据片段确实对应。02 先录优点、再录更靠后的改进标签；证据片段选择该标签所在的首个证据片段，不选位于标签下方的其他片段。这样固定滚动方向不会漏选。

第三条的特殊前置条件：在正确知识库中，预先打开**当前会话内已经完成、带可点击引用的问答**，保持该页面和 App 进程。历史“最近问答”弹层只展示文字和引用数量，不能恢复成可点击引用的会话；退出问答再进入也不会恢复当前回答。如果只剩历史记录，先由你明确决定是否手动发送一次业务问题（可能付费），等结果完成后执行 Flow；脚本本身绝不发送。不要使用验证码问题。选择默认可见的前四条引用之一。

“定位原文”当前会打开该文档的原文页，块页提供行号/段落定位；原文页不保证自动滚到对应行或高亮文字。脚本只检查真实存在的块内容、来源位置和文档预览，不伪造精确高亮。

## 参数

以下值均通过 `maestro test -e NAME=VALUE` 显式传入，没有旧 E2E 数据默认值。除版本号和片段 ID 外，文字选择器按 Maestro **正则表达式**匹配：用足够独特的原文，必要时添加 `.*` 匹配完整文本；文件名的点、括号和引用方括号要转义。不要传 `.*` 这种无法辨认目标的宽泛匹配。缺参、结果不匹配或关键录制失败时 Flow 报错，不会静默跳过。

| Flow         | 必填参数                                                                | 取值说明                                                                                                                |
| ------------ | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 01 / 02 / 04 | `RETAKE_GROUP_NAME`、`RETAKE_AUDIO_TITLE`                               | 唯一分组与音频标题；从分组菜单和录音卡片读取                                                                            |
| 01           | `RETAKE_SEGMENT_A_ID`、`RETAKE_SEGMENT_B_ID`                            | 从 `maestro hierarchy` 中的 `transcript-timeline-item-segment-<ID>` 读取，只传 ID 后缀；B 在 A 之后                     |
| 01           | `RETAKE_SPEAKER_A_TEXT`、`RETAKE_SPEAKER_B_TEXT`                        | 两段真实 Speaker 的显示文字，例如 `Speaker A · 角色置信度 .*%`；必须不同                                                |
| 01           | `RETAKE_ROLE_A_TEXT`、`RETAKE_ROLE_B_TEXT`                              | 片段中真实角色名称，例如“客户”“销售”；不要猜测模型结果                                                                  |
| 01           | `RETAKE_TIME_A_TEXT`、`RETAKE_TIME_B_TEXT`                              | 完整时间范围，例如 `00:03 – 00:12`，注意 UI 使用的连接符                                                                |
| 01           | `RETAKE_EMOTION_A_TEXT`、`RETAKE_EMOTION_B_TEXT`                        | 情绪详情中真实显示的主要情绪文字                                                                                        |
| 02           | `RETAKE_STRENGTH_TAG_TITLE`、`RETAKE_IMPROVEMENT_TAG_TITLE`             | 时间轴中优点和改进标签的真实标题                                                                                        |
| 02           | `RETAKE_STRENGTH_CONCLUSION_TEXT`、`RETAKE_IMPROVEMENT_CONCLUSION_TEXT` | 对应标签“分析结论”的真实完整文字或唯一匹配                                                                              |
| 02           | `RETAKE_STRENGTH_SEGMENT_ID`、`RETAKE_IMPROVEMENT_SEGMENT_ID`           | 标签所在首个证据片段 ID 后缀                                                                                            |
| 02           | `RETAKE_STRENGTH_EVIDENCE_TEXT`、`RETAKE_IMPROVEMENT_EVIDENCE_TEXT`     | 对应证据转写的真实文字或唯一匹配                                                                                        |
| 03           | `RETAKE_KB_NAME`、`RETAKE_DOCUMENT_TITLE`                               | 正确知识库名称和引用文档标题；最后返回文件列表再次核对身份                                                              |
| 03           | `RETAKE_QUESTION_TEXT`、`RETAKE_ANSWER_TEXT`                            | 当前已完成问答的真实问题和回答文字，最好只保留这一组问答                                                                |
| 03           | `RETAKE_CITATION_TEXT`                                                  | 可点击引用的完整标题，例如 `\[1\] 客户服务规范\.md`                                                                     |
| 03           | `RETAKE_SOURCE_TEXT`                                                    | 引用块正文的唯一匹配，例如 `.*七天内.*退款.*`                                                                           |
| 03           | `RETAKE_SOURCE_LOCATION_TEXT`                                           | 块页真实来源位置，例如 `来源位置：.*第 10-18 行`                                                                        |
| 03           | `RETAKE_ORIGINAL_TEXT`                                                  | 文档原文预览中对应内容的唯一匹配；可能与块正文不同                                                                      |
| 04           | `RETAKE_CONFIRMED_VERSION`                                              | 当前已经确认的正整数版本号，例如 `1`；不会执行确认写入                                                                  |
| 04           | `RETAKE_COMPLETED_TASK_TEXT`                                            | 已完成任务的真实状态文字（包括版本/语言），例如 `已完成 · .*确认转写 v1.*`；轻量模式可用 `已在转写时完成声学情绪分析.*` |
| 04           | `RETAKE_REPORT_TEXT`                                                    | 已完成业务报告的真实、有业务意义的一段正文匹配                                                                          |

片段 ID 可在打开目标录音后运行 `maestro hierarchy` 查看。层级输出可能包含私有信息，仅本地核对，不要直接公开上传。下面的占位内容均需替换为真实 UI 数据；不要把示例当作产品结果。

Android 真机树中，片段布局容器可能没有后代，身份文字、情绪按钮、正文和时间戳被暴露为兄弟节点。因此 01 / 02 不使用 `childOf` 或容器上的 `containsDescendants`，也不靠同屏重复文字的上下关系推断片段归属。

01 按 `transcript-time-<ID>` 滚动，时间戳可见即停止（`centerElement: false`）；再对主身份 `transcript-identity-primary-<ID>`、副身份 `transcript-identity-secondary-<ID>`、时间戳和情绪按钮分别断言。每个文字断言同时指定 ID 与预期文字，情绪按钮按该片段 ID 点击。已有角色分析时，主身份显示角色，副身份显示 Speaker 与角色置信度：`RETAKE_ROLE_*_TEXT` 填主身份文字，`RETAKE_SPEAKER_*_TEXT` 填副身份文字，不是“播放片段”标签。时间参数仍填写可见的完整时间范围；已有 `00:00to00:09` 形式的时间 accessibility label 保持不变。

02 按 `transcript-content-<ID>` 滚动，并在同一正文节点上联合校验 ID 与证据文字，避免误认其他片段的相同发言。片段 ID 参数仍只填原有 ID 后缀，无需新增 JSON 参数。强制居中可能越过已经可见的目标；特别长的发言仍需选择能让身份头部、情绪与时间戳同屏的代表片段，不隐藏复核提示、不跳过断言。

`showcase-retake.flattened-hierarchy.json` 是用于静态回归的脱敏结构样例，保留兄弟节点关系并使用虚构 ID 和正文；它不是产品结果，不参与录制，也不证明新标识已暴露在真实设备上。03 / 04 未依赖上述片段容器层级，本次保留其原有选择器；后续失败需按各自真机树审阅。

## 独立 pnpm 入口（推荐）

首次将[参数模板](../../fixtures/showcase-retake.params.example.json)复制到本地忽略目录（已有文件时不要覆盖），将所有 `__SET_...__` 替换为上表的真实数据。JSON 中反斜杠需写成双反斜杠，例如引用匹配写为 `"\\[1\\] 客户服务规范\\.md"`；所有参数值均为字符串，版本号也写为 `"1"`。本地参数可能包含业务内容，不要提交 Git。

```powershell
New-Item -ItemType Directory -Force .artifacts | Out-Null
if (!(Test-Path .artifacts/showcase-retake.params.json)) {
  Copy-Item .maestro/fixtures/showcase-retake.params.example.json .artifacts/showcase-retake.params.json
}
# 编辑 .artifacts/showcase-retake.params.json 后，在交互式终端执行：
pnpm e2e:android:showcase-retake
```

入口自动按 01 → 02 → 03 → 04 顺序执行。**每条开始前暂停提示**，你在手机上准备好对应页面后输入 `y`；其他输入取消整次运行。03 必须手动打开仍保留在当前会话中的已完成回答，不会由 runner 恢复历史或重新提问。第一条失败后立即停止，不跳过、不清理数据。输出为 `.artifacts/maestro/RETAKE_<时间戳>_<随机后缀>/`，包含 `summary.json` 和每条独立素材目录；汇总不保存参数值或设备标识。

此入口不走普通 runner 的服务启动、设备重置、运行模式调整、测试数据准备或资源清理路径；请自行确保 App 与服务器可用。未填写的模板值会在连接设备前报错。

```powershell
# 指定其他本地参数文件：
pnpm e2e:android:showcase-retake --params .artifacts/my-retake.params.json
# 只跑一条（只校验该条所需参数）：
pnpm e2e:android:showcase-retake --flow 03-knowledge-answer-citation
# 从失败处继续（创建新素材目录，不覆盖旧运行）：
pnpm e2e:android:showcase-retake --from 02-business-insights-evidence
```

也可以设置同名 `RETAKE_*` 环境变量，覆盖 JSON 值；没有默认文件时可完全使用环境变量。多设备时显式传 `--device`，不要将设备参数写入公开素材说明。`--non-interactive` 只允许搭配单条 `--flow`，且必须预先准备页面；完整四条补录必须使用交互式终端。`--help` 查看参数。

## Maestro 逐条执行（PowerShell，仓库根目录）

先建立本次唯一输出目录，避免覆盖上次补录：

```powershell
$retakeRun = 'RETAKE_' + (Get-Date -Format 'yyyyMMdd_HHmmss')
$retakeOutput = ".artifacts/maestro/$retakeRun"
$retakeAudioArgs = @(
  '-e', 'RETAKE_GROUP_NAME=你的真实分组',
  '-e', 'RETAKE_AUDIO_TITLE=你的真实录音'
)
```

每条执行前完成上述页面准备。执行成功后才执行下一条；不要一次运行整个文件夹。每条拥有独立 `startRecording` 和 `takeScreenshot` 目录。

```powershell
maestro test .maestro/flows/showcase-retake/01-transcript-speaker-emotion.yaml `
  --test-output-dir "$retakeOutput/01-transcript" @retakeAudioArgs `
  -e 'RETAKE_SEGMENT_A_ID=实际片段A的ID' -e 'RETAKE_SEGMENT_B_ID=实际片段B的ID' `
  -e 'RETAKE_SPEAKER_A_TEXT=实际SpeakerA显示文字' -e 'RETAKE_SPEAKER_B_TEXT=实际SpeakerB显示文字' `
  -e 'RETAKE_ROLE_A_TEXT=实际角色A' -e 'RETAKE_ROLE_B_TEXT=实际角色B' `
  -e 'RETAKE_TIME_A_TEXT=实际时间范围A' -e 'RETAKE_TIME_B_TEXT=实际时间范围B' `
  -e 'RETAKE_EMOTION_A_TEXT=实际情绪A' -e 'RETAKE_EMOTION_B_TEXT=实际情绪B'
if ($LASTEXITCODE -ne 0) { throw '01 补录失败，请检查现场和 commands.json' }
```

```powershell
maestro test .maestro/flows/showcase-retake/02-business-insights-evidence.yaml `
  --test-output-dir "$retakeOutput/02-insights" @retakeAudioArgs `
  -e 'RETAKE_STRENGTH_TAG_TITLE=实际优点标签标题' `
  -e 'RETAKE_IMPROVEMENT_TAG_TITLE=实际改进标签标题' `
  -e 'RETAKE_STRENGTH_CONCLUSION_TEXT=实际优点分析结论' `
  -e 'RETAKE_IMPROVEMENT_CONCLUSION_TEXT=实际改进分析结论' `
  -e 'RETAKE_STRENGTH_SEGMENT_ID=实际优点证据ID' `
  -e 'RETAKE_IMPROVEMENT_SEGMENT_ID=实际改进证据ID' `
  -e 'RETAKE_STRENGTH_EVIDENCE_TEXT=实际优点证据转写' `
  -e 'RETAKE_IMPROVEMENT_EVIDENCE_TEXT=实际改进证据转写'
if ($LASTEXITCODE -ne 0) { throw '02 补录失败，请检查标签与证据对应关系' }
```

03 请先手动进入正确知识库的已完成问答页，勿退出或重启：

```powershell
maestro test .maestro/flows/showcase-retake/03-knowledge-answer-citation.yaml `
  --test-output-dir "$retakeOutput/03-knowledge" `
  -e 'RETAKE_KB_NAME=你的真实知识库' -e 'RETAKE_DOCUMENT_TITLE=客户服务规范\.md' `
  -e 'RETAKE_QUESTION_TEXT=实际已完成的业务问题' `
  -e 'RETAKE_ANSWER_TEXT=实际回答文字' `
  -e 'RETAKE_CITATION_TEXT=\[1\] 客户服务规范\.md' `
  -e 'RETAKE_SOURCE_TEXT=实际引用块正文匹配' `
  -e 'RETAKE_SOURCE_LOCATION_TEXT=实际来源位置匹配' `
  -e 'RETAKE_ORIGINAL_TEXT=实际文档原文匹配'
if ($LASTEXITCODE -ne 0) { throw '03 补录失败，请检查问答会话、引用及知识库身份' }
```

```powershell
maestro test .maestro/flows/showcase-retake/04-confirmation-task-status.yaml `
  --test-output-dir "$retakeOutput/04-status" @retakeAudioArgs `
  -e 'RETAKE_CONFIRMED_VERSION=1' `
  -e 'RETAKE_COMPLETED_TASK_TEXT=实际已完成任务状态匹配' `
  -e 'RETAKE_REPORT_TEXT=实际报告正文匹配'
if ($LASTEXITCODE -ne 0) { throw '04 补录失败，请检查确认版本与完成状态' }
```

执行失败时保留该条输出与现场，不把缺失镜头标为成功。检查 `commands.json` 和失败截图，修正参数或选择合适的已有结果，再用新目录重录；不要添加任意 sleep 或把录屏改为 optional。

## 预期镜头与交回方式

| Flow | 候选镜头 / 截图                                                                           |
| ---- | ----------------------------------------------------------------------------------------- |
| 01   | Speaker A → 角色与时间戳 → 声学情绪详情 → Speaker B 与不同情绪                            |
| 02   | 话术优点 / 待改进点总结 → 标签解释与证据时间范围 → 对应真实发言                           |
| 03   | 已完成业务问题 → grounded answer → 可点击引用 → 块正文 / 来源位置 → 文档原文 → 知识库文件 |
| 04   | 已确认版本 → 原始 / 当前只读视图 → ASR 版本 → 完成任务 → 已完成业务报告                   |

截图用于后续挑选、局部聚焦和静帧延长，Flow 不为截图人为停顿；原录屏的导航与读取等待会在后续剪辑中去除。长转写/长答案无法同屏时断言可能失败，请挑选较短且有代表性的真实结果，不弱化断言。

将整个 `$retakeOutput` 目录交回，保留各条的 MP4、截图、`commands.json`、manifest 与日志，不只上传单独成片。附上四条成功/失败状态、使用的业务素材名称、可公开范围，以及特别值得保留的时间段。可以将完整目录放入 `.artifacts/maestro/SHOWCASE_FINISH` 的新子目录，保留旧素材，之后提供路径再发起审片/剪辑指令。交回前人工检查并去除日志中的私有信息，原录屏不要先裁切或加字幕。

## 本地验证与状态

```powershell
pnpm e2e:android:test
maestro check-syntax .maestro/flows/showcase-retake/01-transcript-speaker-emotion.yaml
maestro check-syntax .maestro/flows/showcase-retake/02-business-insights-evidence.yaml
maestro check-syntax .maestro/flows/showcase-retake/03-knowledge-answer-citation.yaml
maestro check-syntax .maestro/flows/showcase-retake/04-confirmation-task-status.yaml
```

语法检查与静态安全检查不等于真机运行通过。新增时未连接 Android 设备，真机补录由你逐条执行；后续根据实际截图与命令轨迹修正定位，不提前宣称四条 Flow 已通过。
