param(
  [Parameter(Mandatory = $true)]
  [string]$RunId,

  [string]$Voice = 'zh-CN-YunyangNeural',

  [switch]$MaskOverlay,

  [switch]$ResumePlan
)

$ErrorActionPreference = 'Stop'
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$repositoryRoot = Resolve-Path (Join-Path $scriptDirectory '..\..')
$renderer = Join-Path $scriptDirectory 'render-video.mjs'
$outputDirectory = Join-Path $repositoryRoot ".artifacts\showcase-video\$RunId"
$planPath = Join-Path $outputDirectory 'render-plan.json'
if (-not $ResumePlan) {
  $arguments = @($renderer, '--run', $RunId, '--prepare-assets', '--voice', $Voice)
  if ($MaskOverlay) { $arguments += '--mask-overlay' }
  & node @arguments
  if ($LASTEXITCODE -ne 0) { throw '生成渲染计划失败。' }
}
$plan = Get-Content -LiteralPath $planPath -Raw | ConvertFrom-Json
$workDirectory = $plan.workDirectory

$ffmpeg = Get-ChildItem -LiteralPath (Join-Path $repositoryRoot '.artifacts\tools') -Recurse -Filter ffmpeg.exe |
  Select-Object -First 1 -ExpandProperty FullName
$ffprobe = Get-ChildItem -LiteralPath (Join-Path $repositoryRoot '.artifacts\tools') -Recurse -Filter ffprobe.exe |
  Select-Object -First 1 -ExpandProperty FullName
if (-not $ffmpeg -or -not $ffprobe) {
  throw '缺少 FFmpeg/FFprobe。请先运行 pnpm showcase:video -- --prepare-tools。'
}

$python = (Get-Command python -ErrorAction Stop).Source
$edgeTtsRoot = Join-Path $repositoryRoot '.artifacts\tools\edge-tts'
New-Item -ItemType Directory -Force -Path $edgeTtsRoot | Out-Null
$previousPythonPath = $env:PYTHONPATH
$env:PYTHONPATH = (@($edgeTtsRoot, $previousPythonPath) | Where-Object { $_ }) -join ';'
& $python -c 'import edge_tts' 2>$null
if ($LASTEXITCODE -ne 0) {
  & $python -m pip install --disable-pip-version-check --target $edgeTtsRoot edge-tts
  if ($LASTEXITCODE -ne 0) { throw '安装 edge-tts 失败。' }
}

function Invoke-Checked([string]$Command, [string[]]$Arguments) {
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) { throw "命令失败：$Command" }
}

function ConvertTo-FilterPath([string]$Path) {
  return ($Path -replace '\\', '/') -replace '^([A-Za-z]):', '$1\:'
}

$shotFiles = @()
for ($index = 0; $index -lt $plan.shots.Count; $index += 1) {
  $shot = $plan.shots[$index]
  $duration = ([double]$shot.duration).ToString('0.000', [Globalization.CultureInfo]::InvariantCulture)
  $fadeOut = ([Math]::Max(0, [double]$shot.duration - 0.28)).ToString('0.000', [Globalization.CultureInfo]::InvariantCulture)
  $shotPath = Join-Path $workDirectory ('shot-{0:D2}.mp4' -f ($index + 1))
  if (Test-Path -LiteralPath $shotPath) {
    $shotFiles += $shotPath
    continue
  }
  if ($shot.image) {
    $sourceFilter = if ($MaskOverlay) {
      'delogo=x=890:y=1090:w=180:h=220:show=0,format=rgba'
    } else {
      'format=rgba'
    }
    $filter = @(
      "[0:v]$sourceFilter,split=2[bgsrc][fgsrc]"
      '[bgsrc]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,gblur=sigma=42,eq=brightness=-0.62:saturation=0.72[blurred]'
      "color=c=0x030D2B:s=1920x1080:r=30:d=$duration[base]"
      '[base][blurred]blend=all_mode=screen:all_opacity=0.16[backdrop]'
      "[fgsrc]scale=432:960:force_original_aspect_ratio=decrease,pad=432:960:-1:-1:color=white,zoompan=z='min(zoom+0.00018,1.055)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=432x960:fps=30[phone]"
      '[backdrop]drawbox=x=1314:y=45:w=464:h=990:color=black@0.38:t=fill[shadow]'
      "[shadow][phone]overlay=x=1330:y=60:format=auto,drawbox=x='mod(t*95,1920)':y=0:w=2:h=1080:color=0x16D9FF@0.10:t=fill,fade=t=in:st=0:d=0.28,fade=t=out:st=${fadeOut}:d=0.28,format=yuv420p[out]"
    ) -join ';'
    Invoke-Checked $ffmpeg @('-y', '-loop', '1', '-i', $shot.image, '-filter_complex', $filter, '-map', '[out]', '-r', '30', '-t', $duration, '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p', $shotPath)
  } else {
    $logoScale = if ($shot.sectionIndex -eq 8) { 310 } else { 430 }
    $logoX = if ($shot.sectionIndex -eq 8) { '1430' } else { '(W-w)/2' }
    $logoY = if ($shot.sectionIndex -eq 8) { '(H-h)/2' } else { '(H-h)/2-20' }
    $filter = @(
      "color=c=0x030D2B:s=1920x1080:r=30:d=$duration[base]"
      "[0:v]scale=$logoScale`:-1,format=rgba,fade=t=in:st=0:d=0.9:alpha=1[logo]"
      "[base][logo]overlay=x=$logoX`:y=$logoY`:format=auto,drawbox=x='mod(t*105,1920)':y=160:w=220:h=2:color=0x16D9FF@0.35:t=fill,fade=t=in:st=0:d=0.35,fade=t=out:st=${fadeOut}:d=0.28,format=yuv420p[out]"
    ) -join ';'
    Invoke-Checked $ffmpeg @('-y', '-loop', '1', '-i', $plan.logoPath, '-filter_complex', $filter, '-map', '[out]', '-r', '30', '-t', $duration, '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p', $shotPath)
  }
  $shotFiles += $shotPath
}

$concatPath = Join-Path $workDirectory 'shots.txt'
$shotFiles | ForEach-Object { "file '$($_ -replace '\\', '/')'" } | Set-Content -LiteralPath $concatPath -Encoding utf8
$visualBase = Join-Path $workDirectory 'visual-base.mp4'
Invoke-Checked $ffmpeg @('-y', '-f', 'concat', '-safe', '0', '-i', $concatPath, '-t', '150', '-c', 'copy', $visualBase)

$assPath = Join-Path $outputDirectory 'subtitles-zh-en.ass'
$fontDirectory = Split-Path -Parent $plan.regularFont
$assFilter = ConvertTo-FilterPath $assPath
$fontFilter = ConvertTo-FilterPath $fontDirectory
$titledVisual = Join-Path $workDirectory 'visual-titled.mp4'
Invoke-Checked $ffmpeg @('-y', '-i', $visualBase, '-vf', "ass='$assFilter':fontsdir='$fontFilter'", '-t', '150', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-an', $titledVisual)

$scriptData = Get-Content -LiteralPath (Join-Path $outputDirectory 'video-script.md') -Raw
$narrationTexts = [regex]::Matches($scriptData, '(?m)^\| \d{2}:\d{2}.+\|$') | ForEach-Object {
  ($_.Value -split '\|')[3].Trim()
}
$chapterStarts = @(0, 7, 20, 38, 54, 77, 97, 115, 127, 142)
$narrationInputs = @()
for ($index = 0; $index -lt $narrationTexts.Count; $index += 1) {
  $narrationInput = Join-Path $workDirectory ('narration-{0:D2}.mp3' -f ($index + 1))
  Invoke-Checked $python @('-m', 'edge_tts', '--voice', $Voice, '--rate=+5%', '--text', $narrationTexts[$index], '--write-media', $narrationInput)
  $narrationInputs += $narrationInput
}

$narrationPath = Join-Path $outputDirectory 'narration-zh.wav'
$narrationArguments = @('-y')
$narrationInputs | ForEach-Object { $narrationArguments += @('-i', $_) }
$voiceFilters = @()
for ($index = 0; $index -lt $narrationInputs.Count; $index += 1) {
  $delay = $chapterStarts[$index] * 1000
  $voiceFilters += "[$index`:a]aresample=48000,volume=1,adelay=$delay|$delay[voice$index]"
}
$voiceLabels = (0..($narrationInputs.Count - 1) | ForEach-Object { "[voice$_]" }) -join ''
$voiceFilters += "${voiceLabels}amix=inputs=$($narrationInputs.Count):duration=longest:dropout_transition=0,apad,atrim=0:150[narration]"
$narrationArguments += @('-filter_complex', ($voiceFilters -join ';'), '-map', '[narration]', '-c:a', 'pcm_s16le', $narrationPath)
Invoke-Checked $ffmpeg $narrationArguments

$musicPath = Join-Path $outputDirectory 'music-and-sfx.wav'
$masterPath = Join-Path $outputDirectory 'EchoWave-demo-zh-en-1080p.mp4'
Invoke-Checked $ffmpeg @('-y', '-i', $titledVisual, '-i', $narrationPath, '-i', $musicPath, '-filter_complex', '[1:a]volume=1.0[voice];[2:a]volume=0.50[music];[voice][music]amix=inputs=2:duration=longest:dropout_transition=0,loudnorm=I=-14:TP=-1.5:LRA=11[audio]', '-map', '0:v:0', '-map', '[audio]', '-t', '150', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', $masterPath)
$cleanPath = Join-Path $outputDirectory 'EchoWave-demo-clean-1080p.mp4'
Invoke-Checked $ffmpeg @('-y', '-i', $titledVisual, '-i', $musicPath, '-filter_complex', '[1:a]volume=0.72,loudnorm=I=-18:TP=-1.5:LRA=11[audio]', '-map', '0:v:0', '-map', '[audio]', '-t', '150', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', $cleanPath)
$thumbnailPath = Join-Path $outputDirectory 'thumbnail.png'
Invoke-Checked $ffmpeg @('-y', '-ss', '82', '-i', $masterPath, '-frames:v', '1', $thumbnailPath)

$probe = & $ffprobe -v error -show_entries 'format=duration,size:stream=codec_type,codec_name,width,height,sample_rate,channels' -of json $masterPath | ConvertFrom-Json
$video = $probe.streams | Where-Object codec_type -eq 'video' | Select-Object -First 1
$audio = $probe.streams | Where-Object codec_type -eq 'audio' | Select-Object -First 1
$levelOutput = & $ffmpeg -hide_banner -nostats -i $masterPath -filter_complex 'ebur128=peak=true' -f null NUL 2>&1 | Out-String
$integratedMatches = [regex]::Matches($levelOutput, '\bI:\s+(-?\d+(?:\.\d+)?) LUFS')
$peakMatches = [regex]::Matches($levelOutput, '\bPeak:\s+(-?\d+(?:\.\d+)?) dBFS')
$integratedLufs = if ($integratedMatches.Count) { [double]$integratedMatches[$integratedMatches.Count - 1].Groups[1].Value } else { $null }
$truePeakDbtp = if ($peakMatches.Count) { [double]$peakMatches[$peakMatches.Count - 1].Groups[1].Value } else { $null }
$qa = [ordered]@{
  runId = $RunId
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
  status = 'completed'
  checks = [ordered]@{
    duration = @{ expectedSeconds = 150; actualSeconds = [double]$probe.format.duration; passed = [Math]::Abs([double]$probe.format.duration - 150) -le 0.25 }
    dimensions = @{ expected = '1920x1080'; actual = "$($video.width)x$($video.height)"; passed = $video.width -eq 1920 -and $video.height -eq 1080 }
    audio = @{ passed = $null -ne $audio; codec = $audio.codec_name }
    audioLevels = @{ integratedLufs = $integratedLufs; truePeakDbtp = $truePeakDbtp; passed = $null -ne $truePeakDbtp -and $truePeakDbtp -le -1 }
    showcaseFootage = @{ passed = $false; note = '当前为 stable 降级素材审阅版。' }
    manualVisualReview = @{ passed = $false; required = $true }
  }
  publishReady = $false
  note = '这是使用 stable 降级素材生成的审阅版；真实 ASR/RAG Showcase 重录后才能标记为公开发布版。'
}
$qa | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $outputDirectory 'qa-report.json') -Encoding utf8
$manifest = [ordered]@{
  runId = $RunId
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
  sourceDirectory = Join-Path $repositoryRoot ".artifacts\maestro\$RunId"
  voice = $Voice
  durationSeconds = 150
  maskOverlay = [bool]$MaskOverlay
  renderPlan = $planPath
  outputs = @{ master = $masterPath; clean = $cleanPath; narration = $narrationPath; musicAndSfx = $musicPath; subtitles = $assPath; script = Join-Path $outputDirectory 'video-script.md'; thumbnail = $thumbnailPath }
}
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $outputDirectory 'render-manifest.json') -Encoding utf8
$env:PYTHONPATH = $previousPythonPath
Write-Output "Showcase 视频已生成：$masterPath"
