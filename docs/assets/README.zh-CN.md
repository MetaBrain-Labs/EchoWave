# README 媒体资源

[English](./README.md) | **简体中文**

本目录保存根 README 内嵌的、体积可控且受版本管理的小型媒体文件。原始录像、剪辑表与完整成片不进入仓库。

## demo.gif

`demo.gif` 是根 README 的首页演示图，由已有产品影片中三段真实录屏拼接而成，串成一条完整的产品故事：

| 片段 | 来源               | 时间窗口 | 展示内容                                 |
| ---- | ------------------ | -------- | ---------------------------------------- |
| 1    | `hero-1-1080p.mp4` | 3.6–6.2s | 已确认转写、说话人、角色置信度与情绪标签 |
| 2    | `hero-2-1080p.mp4` | 5.6–8.2s | 业务分析发现卡片及其分析结论             |
| 3    | `hero-3-1080p.mp4` | 0.2–2.8s | 带引用标记的知识库回答                   |

当前文件事实：

- 640×360、12 fps、93 帧、7.76 秒、约 2.9 MB、静音、循环播放。
- 画面内容是未经修改的产品界面。渲染器只裁剪并平移已录制的像素，不会重绘界面或替换产品文案。
- 76 秒完整影片与可复用的 `hero-1/2/3` 片段属于本地 showcase 产物，按设计不提交；`docs/assets/` 只存放面向 README 的派生文件。

## 重新生成该资源

showcase 渲染默认输出到 `.artifacts/showcase-video/`，该目录被 `.gitignore` 忽略。请先在仓库根目录重建 hero 片段，并使用渲染器自身的 FFmpeg 解析结果（本仓库的 FFmpeg 不在 `PATH` 上）：

```powershell
# 1. 从已有录像重建 hero 预览与完整影片
pnpm showcase:video -- --heroes
pnpm showcase:video

# 2. 每个场景各截取一段（seg-2、seg-3 同理，只改输入与时间窗口）
$ffmpeg = (Get-ChildItem .artifacts/tools -Recurse -Filter ffmpeg.exe | Select-Object -First 1).FullName
$src = '.artifacts/showcase-video/LAUNCH_REFINED_20260913'
& $ffmpeg -v error -y -ss 3.6 -to 6.2 -i "$src/hero-1-1080p.mp4" `
  -vf "fps=12,scale=640:-2:flags=lanczos,setsar=1" `
  -c:v libx264 -crf 16 -pix_fmt yuv420p -an .artifacts/showcase-video/seg-1.mp4

# 3. 用 concat demuxer 拼接，再编码 GIF
#    concat.txt 内为 seg-1.mp4、seg-2.mp4、seg-3.mp4 的绝对路径
& $ffmpeg -v error -y -f concat -safe 0 -i .artifacts/showcase-video/concat.txt `
  -c copy .artifacts/showcase-video/preview-clip.mp4
& $ffmpeg -v error -y -i .artifacts/showcase-video/preview-clip.mp4 `
  -vf "fps=12,split[g0][g1];[g0]palettegen=max_colors=192:stats_mode=diff[pal];[g1][pal]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" `
  -loop 0 docs/assets/demo.gif
```

保持该资源可用的规则：

- `demo.gif` 必须小于 5 MB 且宽度为 640px，避免拖慢 README；要先降低帧率，再考虑牺牲可读性。
- 场景之间使用硬切。淡入淡出会在该尺寸下糊掉界面文字。
- 优先使用 concat demuxer，不要用单个 `trim`/`concat` 滤镜图：滤镜图可能复制帧并把 GIF 时长放大。
- 当录制的产品界面与当前 App 不再一致时重新渲染，并把上表中的时间窗口更新为实际值。
- 提交前必须人工查看生成的 GIF。帧数与时长检查不能证明动画可读。

## 许可证与来源

画面内容是本项目自身的应用。该 GIF 属于仓库内容，遵循根目录 [Apache License 2.0](../../LICENSE)。音乐许可与署名只作用于已发布的完整影片，不作用于这份静音派生文件。
