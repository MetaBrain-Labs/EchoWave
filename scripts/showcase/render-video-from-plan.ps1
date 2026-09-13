param(
  [string]$Output = '.artifacts/showcase-video/LAUNCH_REFINED_20260913',
  [switch]$Heroes,
  [switch]$PrepareAssets,
  [string]$MusicConfig,
  [string]$Python,
  [switch]$QaOnly
)

# 两个入口共用同一显式剪辑表及渲染逻辑，避免恢复旧版截图/TTS 计划。
$ErrorActionPreference = 'Stop'
$renderer = Join-Path $PSScriptRoot 'render-video.mjs'
$renderArguments = @($renderer, '--output', $Output)
if ($Heroes) { $renderArguments += '--heroes' }
if ($PrepareAssets) { $renderArguments += '--prepare-assets' }
if ($QaOnly) { $renderArguments += '--qa-only' }
if ($MusicConfig) { $renderArguments += @('--music-config', $MusicConfig) }
if ($Python) { $renderArguments += @('--python', $Python) }
& node @renderArguments
exit $LASTEXITCODE
