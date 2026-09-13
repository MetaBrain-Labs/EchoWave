# README Media Assets

**English** | [简体中文](./README.zh-CN.md)

This directory stores the small, version-controlled media that the root README embeds. Source footage, timelines, and full-length films stay outside Git.

## demo.gif

`demo.gif` is the root README hero animation. It is assembled from three real screen-recording segments of the existing product film and shows one continuous product story:

| Segment | Source             | Window   | What it shows                                               |
| ------- | ------------------ | -------- | ----------------------------------------------------------- |
| 1       | `hero-1-1080p.mp4` | 3.6–6.2s | Confirmed transcript, speaker, role confidence, emotion tag |
| 2       | `hero-2-1080p.mp4` | 5.6–8.2s | Business-analysis finding card with its conclusion          |
| 3       | `hero-3-1080p.mp4` | 0.2–2.8s | Knowledge-base answer with a citation marker                |

Facts about the current file:

- 640×360, 12 fps, 93 frames, 7.76s, about 2.9 MB, silent, loops forever.
- The frame content is unmodified product UI. The renderer crops and moves existing recorded pixels; it never redraws the interface or replaces product text.
- The full 76-second film and the reusable `hero-1/2/3` clips are local showcase artifacts and are intentionally not committed. `docs/assets/` exists for the README-sized derivative only.

## Regenerating the asset

The showcase pipeline writes its render into `.artifacts/showcase-video/`, which `.gitignore` excludes. Regenerate the hero clips first, from the repository root, using the renderer's own FFmpeg resolution (FFmpeg is not on `PATH` in this repository):

```powershell
# 1. Rebuild the hero previews and the full film from the existing recordings
pnpm showcase:video -- --heroes
pnpm showcase:video

# 2. Cut one identical segment per scene (repeat for seg-2 and seg-3)
$ffmpeg = (Get-ChildItem .artifacts/tools -Recurse -Filter ffmpeg.exe | Select-Object -First 1).FullName
$src = '.artifacts/showcase-video/LAUNCH_REFINED_20260913'
& $ffmpeg -v error -y -ss 3.6 -to 6.2 -i "$src/hero-1-1080p.mp4" `
  -vf "fps=12,scale=640:-2:flags=lanczos,setsar=1" `
  -c:v libx264 -crf 16 -pix_fmt yuv420p -an .artifacts/showcase-video/seg-1.mp4

# 3. Join the segments with the concat demuxer, then encode the GIF
#    concat.txt lists absolute paths to seg-1.mp4, seg-2.mp4, and seg-3.mp4
& $ffmpeg -v error -y -f concat -safe 0 -i .artifacts/showcase-video/concat.txt `
  -c copy .artifacts/showcase-video/preview-clip.mp4
& $ffmpeg -v error -y -i .artifacts/showcase-video/preview-clip.mp4 `
  -vf "fps=12,split[g0][g1];[g0]palettegen=max_colors=192:stats_mode=diff[pal];[g1][pal]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" `
  -loop 0 docs/assets/demo.gif
```

Rules for keeping this asset usable:

- Keep `demo.gif` below 5 MB and at 640px width so the README stays fast; lower the frame rate before lowering readability.
- Use hard cuts between scenes. Cross-fades blur interface text at this size.
- Prefer the concat demuxer over a single `trim`/`concat` filter graph: the filter graph can duplicate frames and inflate the GIF duration.
- Re-render this asset when the recorded product UI no longer matches the current app, and update the window table above with the actual values.
- Review the rendered GIF visually before committing. Frame-count and duration checks do not prove that the animation is readable.

## License and provenance

The footage shows this project's own application. The GIF is part of the repository and is covered by the root [Apache License 2.0](../../LICENSE). Music licensing and attribution apply only to the published full-length film, not to this silent derivative.
