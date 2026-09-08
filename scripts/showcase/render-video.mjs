import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertValidRunId, parseArgs } from '../e2e/lib.mjs';
import {
  SHOWCASE_DURATION_SECONDS,
  SHOWCASE_SCRIPT,
  extractCommandTimeline,
  renderShowcaseAss,
  renderShowcaseScriptMarkdown,
  resolveSectionVisuals,
  validateShowcaseMediaProbe,
  validateShowcaseScript,
} from '../e2e/showcase-video-lib.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDirectory, '..', '..');
const maestroArtifactsRoot = join(repoRoot, '.artifacts', 'maestro');
const videoArtifactsRoot = join(repoRoot, '.artifacts', 'showcase-video');
const toolsRoot = join(repoRoot, '.artifacts', 'tools');
const pythonLauncher = join(scriptDirectory, 'invoke-python.ps1');
const logoPath = join(repoRoot, 'apps', 'mobile', 'assets', 'img', 'icon.png');
const regularFont = join(
  repoRoot,
  'apps',
  'mobile',
  'assets',
  'fonts',
  'SourceHanSansCN-Regular.otf',
);
const mediaToolsPackageRoot = join(toolsRoot, 'ffmpeg-npm');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
    maxBuffer: 64 * 1024 * 1024,
    stdio: options.inherit ? 'inherit' : 'pipe',
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(
      `命令失败 (${result.status})：${basename(command)} ${args.join(' ')}\n${[result.stdout, result.stderr].filter(Boolean).join('\n').trim()}`,
    );
  }
  return result;
}

function runPython(python, args, options = {}) {
  if (process.platform !== 'win32') return run(python, args, options);
  return run(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      pythonLauncher,
      python,
      ...args,
    ],
    options,
  );
}

function findFiles(directory, fileName) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? findFiles(path, fileName) : entry.name === fileName ? [path] : [];
  });
}

function findOnPath(name) {
  const extensions = extname(name) ? [''] : ['', '.exe', '.cmd', '.bat'];
  for (const directory of String(process.env.PATH ?? '').split(delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = join(directory, `${name}${extension}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function installPlatformMediaTools() {
  const pnpm = findOnPath(process.platform === 'win32' ? 'pnpm.ps1' : 'pnpm');
  if (!pnpm) throw new Error('未找到 pnpm，无法准备 FFmpeg 平台包。');
  mkdirSync(mediaToolsPackageRoot, { recursive: true });
  const packagePath = join(mediaToolsPackageRoot, 'package.json');
  if (!existsSync(packagePath)) {
    writeFileSync(packagePath, '{"name":"echowave-showcase-media-tools","private":true}\n');
  }
  const pnpmArguments = [
    'add',
    '--ignore-workspace',
    '--save-exact',
    '@ffmpeg-installer/ffmpeg@1.1.0',
    '@ffprobe-installer/ffprobe@2.1.2',
  ];
  if (process.platform === 'win32') {
    run(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        pnpm,
        ...pnpmArguments,
      ],
      { cwd: mediaToolsPackageRoot, inherit: true },
    );
    return;
  }
  run(pnpm, pnpmArguments, { cwd: mediaToolsPackageRoot, inherit: true });
}

function ensureFfmpeg(options) {
  const explicit = options.ffmpeg ? resolve(String(options.ffmpeg)) : null;
  const fromPath = findOnPath('ffmpeg.exe') ?? findOnPath('ffmpeg');
  const localCandidates = findFiles(toolsRoot, 'ffmpeg.exe');
  let ffmpeg = [explicit, fromPath, ...localCandidates].find((path) => path && existsSync(path));
  if (!ffmpeg && !options['prepare-tools']) {
    throw new Error('未找到 FFmpeg。请增加 --prepare-tools，将工具安装到 .artifacts/tools。');
  }
  if (!ffmpeg) {
    installPlatformMediaTools();
    ffmpeg = findFiles(mediaToolsPackageRoot, 'ffmpeg.exe')[0];
  }
  if (!ffmpeg) throw new Error('FFmpeg 平台包安装完成后仍未找到 ffmpeg.exe。');
  const adjacentFfprobe = join(dirname(ffmpeg), 'ffprobe.exe');
  const ffprobe = existsSync(adjacentFfprobe)
    ? adjacentFfprobe
    : findFiles(toolsRoot, 'ffprobe.exe')[0];
  if (!ffprobe) throw new Error('缺少 FFprobe；请使用 --prepare-tools 安装完整媒体工具。');
  return { ffmpeg, ffprobe };
}

function resolvePython(options) {
  const explicit = options.python ? resolve(String(options.python)) : null;
  const candidates = [explicit, findOnPath('python.exe'), findOnPath('python')];
  const python = candidates.find((path) => path && existsSync(path));
  if (!python) throw new Error('未找到 Python；请通过 --python 指定解释器。');
  return python;
}

function ensureEdgeTts(python, options) {
  const moduleRoot = join(toolsRoot, 'edge-tts');
  mkdirSync(moduleRoot, { recursive: true });
  const env = {
    PYTHONPATH: [moduleRoot, process.env.PYTHONPATH].filter(Boolean).join(';'),
  };
  let check = runPython(python, ['-c', 'import edge_tts'], { allowFailure: true, env });
  if (check.status !== 0 && options['prepare-tools']) {
    runPython(
      python,
      ['-m', 'pip', 'install', '--disable-pip-version-check', '--target', moduleRoot, 'edge-tts'],
      { inherit: true },
    );
    check = runPython(python, ['-c', 'import edge_tts'], { allowFailure: true, env });
  }
  if (check.status !== 0) {
    throw new Error('未找到 edge-tts。请增加 --prepare-tools 生成神经 TTS 草稿。');
  }
  return env;
}

function newestRunId() {
  if (!existsSync(maestroArtifactsRoot)) throw new Error('不存在 Maestro 产物目录。');
  const candidates = readdirSync(maestroArtifactsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^E2E_/u.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  const runId = candidates.find((candidate) =>
    existsSync(join(maestroArtifactsRoot, candidate, 'summary.json')),
  );
  if (!runId) throw new Error('没有包含 summary.json 的 Maestro 运行产物。');
  return runId;
}

function writePcmWave(path, durationSeconds = SHOWCASE_DURATION_SECONDS) {
  const sampleRate = 48_000;
  const channels = 2;
  const bytesPerSample = 2;
  const frames = Math.round(durationSeconds * sampleRate);
  const dataSize = frames * channels * bytesPerSample;
  const buffer = Buffer.allocUnsafe(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  buffer.writeUInt16LE(channels * bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  const boundaries = SHOWCASE_SCRIPT.slice(1).map((section) => section.start);
  let randomState = 0x56f2c6;
  const random = () => {
    randomState ^= randomState << 13;
    randomState ^= randomState >>> 17;
    randomState ^= randomState << 5;
    return ((randomState >>> 0) / 0xffffffff) * 2 - 1;
  };
  for (let frame = 0; frame < frames; frame += 1) {
    const time = frame / sampleRate;
    const beat = time % (60 / 90);
    const pad =
      Math.sin(2 * Math.PI * 110 * time) * 0.026 +
      Math.sin(2 * Math.PI * 164.81 * time + 0.4) * 0.018 +
      Math.sin(2 * Math.PI * 220 * time + Math.sin(time * 0.22) * 0.7) * 0.012;
    const pulse = Math.exp(-beat * 7) * Math.sin(2 * Math.PI * 55 * time) * 0.018;
    let transition = 0;
    for (const boundary of boundaries) {
      const delta = time - boundary;
      if (delta >= -0.25 && delta <= 0.45) {
        const envelope = 1 - Math.abs((delta + 0.25) / 0.7 - 0.5) * 2;
        transition += random() * Math.max(0, envelope) * 0.014;
      }
    }
    const fade = Math.min(1, time / 2, (durationSeconds - time) / 3);
    const left = Math.max(-1, Math.min(1, (pad + pulse + transition) * Math.max(0, fade)));
    const right = Math.max(
      -1,
      Math.min(1, (pad * 0.96 + pulse * 0.9 - transition * 0.7) * Math.max(0, fade)),
    );
    const offset = 44 + frame * 4;
    buffer.writeInt16LE(Math.round(left * 32767), offset);
    buffer.writeInt16LE(Math.round(right * 32767), offset + 2);
  }
  writeFileSync(path, buffer);
}

function ffmpegFilterPath(path) {
  return path
    .replaceAll('\\', '/')
    .replace(/^([A-Za-z]):/u, '$1\\:')
    .replaceAll("'", "'\\''");
}

function renderShot(ffmpeg, shot, path, maskOverlay) {
  const duration = shot.duration.toFixed(3);
  const fadeOut = Math.max(0, shot.duration - 0.28).toFixed(3);
  const common = [
    '-y',
    '-r',
    '30',
    '-t',
    duration,
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '19',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    path,
  ];

  if (shot.image) {
    const sourceFilter = maskOverlay
      ? 'delogo=x=890:y=1090:w=180:h=220:show=0,format=rgba'
      : 'format=rgba';
    const filter = [
      `[0:v]${sourceFilter},split=2[bgsrc][fgsrc]`,
      '[bgsrc]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,gblur=sigma=42,eq=brightness=-0.62:saturation=0.72[blurred]',
      `color=c=0x030D2B:s=1920x1080:r=30:d=${duration}[base]`,
      '[base][blurred]blend=all_mode=screen:all_opacity=0.16[backdrop]',
      "[fgsrc]scale=432:960:force_original_aspect_ratio=decrease,pad=432:960:-1:-1:color=white,zoompan=z='min(zoom+0.00018,1.055)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=432x960:fps=30[phone]",
      '[backdrop]drawbox=x=1314:y=45:w=464:h=990:color=black@0.38:t=fill[shadow]',
      `[shadow][phone]overlay=x=1330:y=60:format=auto,drawbox=x='mod(t*95,1920)':y=0:w=2:h=1080:color=0x16D9FF@0.10:t=fill,fade=t=in:st=0:d=0.28,fade=t=out:st=${fadeOut}:d=0.28,format=yuv420p[out]`,
    ].join(';');
    run(
      ffmpeg,
      [
        '-y',
        '-loop',
        '1',
        '-i',
        shot.image,
        '-filter_complex',
        filter,
        '-map',
        '[out]',
        ...common.slice(1),
      ],
      {
        inherit: true,
      },
    );
    return;
  }

  const logoScale = shot.sectionIndex === 8 ? 310 : 430;
  const logoX = shot.sectionIndex === 8 ? '1430' : '(W-w)/2';
  const logoY = shot.sectionIndex === 8 ? '(H-h)/2' : '(H-h)/2-20';
  const filter = [
    `color=c=0x030D2B:s=1920x1080:r=30:d=${duration}[base]`,
    `[0:v]scale=${logoScale}:-1,format=rgba,fade=t=in:st=0:d=0.9:alpha=1[logo]`,
    `[base][logo]overlay=x=${logoX}:y=${logoY}:format=auto,drawbox=x='mod(t*105,1920)':y=160:w=220:h=2:color=0x16D9FF@0.35:t=fill,fade=t=in:st=0:d=0.35,fade=t=out:st=${fadeOut}:d=0.28,format=yuv420p[out]`,
  ].join(';');
  run(
    ffmpeg,
    [
      '-y',
      '-loop',
      '1',
      '-i',
      logoPath,
      '-filter_complex',
      filter,
      '-map',
      '[out]',
      ...common.slice(1),
    ],
    {
      inherit: true,
    },
  );
}

function buildShotSchedule(resolvedSections) {
  return resolvedSections.flatMap((section, sectionIndex) => {
    const images = section.selected.length ? section.selected : [null];
    const total = section.end - section.start;
    return images.map((image, imageIndex) => {
      const start = section.start + (total * imageIndex) / images.length;
      const end = section.start + (total * (imageIndex + 1)) / images.length;
      return { sectionIndex, image, start, end, duration: end - start };
    });
  });
}

function generateNarration({ ffmpeg, python, pythonEnv, workDirectory, outputPath, voice }) {
  const inputs = [];
  for (const [index, section] of SHOWCASE_SCRIPT.entries()) {
    const path = join(workDirectory, `narration-${String(index + 1).padStart(2, '0')}.mp3`);
    runPython(
      python,
      [
        '-m',
        'edge_tts',
        '--voice',
        voice,
        '--rate=+5%',
        '--text',
        section.narrationZh,
        '--write-media',
        path,
      ],
      { env: pythonEnv, inherit: true },
    );
    inputs.push(path);
  }

  const filterParts = inputs.map(
    (_, index) =>
      `[${index}:a]aresample=48000,volume=1,adelay=${Math.round(SHOWCASE_SCRIPT[index].start * 1000)}|${Math.round(SHOWCASE_SCRIPT[index].start * 1000)}[voice${index}]`,
  );
  filterParts.push(
    `${inputs.map((_, index) => `[voice${index}]`).join('')}amix=inputs=${inputs.length}:duration=longest:dropout_transition=0,apad,atrim=0:${SHOWCASE_DURATION_SECONDS}[narration]`,
  );
  run(
    ffmpeg,
    [
      '-y',
      ...inputs.flatMap((path) => ['-i', path]),
      '-filter_complex',
      filterParts.join(';'),
      '-map',
      '[narration]',
      '-c:a',
      'pcm_s16le',
      outputPath,
    ],
    { inherit: true },
  );
}

function probeMedia(ffprobe, path) {
  const result = run(ffprobe, [
    '-v',
    'error',
    '-show_entries',
    'format=duration,size:stream=index,codec_type,codec_name,width,height,sample_rate,channels',
    '-of',
    'json',
    path,
  ]);
  return JSON.parse(result.stdout);
}

function analyzeAudioLevels(ffmpeg, path) {
  const sink = process.platform === 'win32' ? 'NUL' : '/dev/null';
  const result = run(
    ffmpeg,
    [
      '-hide_banner',
      '-nostats',
      '-i',
      path,
      '-filter_complex',
      'ebur128=peak=true',
      '-f',
      'null',
      sink,
    ],
    { allowFailure: true },
  );
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const integrated = [...output.matchAll(/\bI:\s+(-?\d+(?:\.\d+)?) LUFS/gmu)].at(-1);
  const peak = [...output.matchAll(/\bPeak:\s+(-?\d+(?:\.\d+)?) dBFS/gmu)].at(-1);
  return {
    integratedLufs: integrated ? Number(integrated[1]) : null,
    truePeakDbtp: peak ? Number(peak[1]) : null,
    passed: Boolean(peak) && Number(peak[1]) <= -1,
  };
}

async function main() {
  validateShowcaseScript();
  const { options } = parseArgs(process.argv.slice(2));
  const runId = assertValidRunId(options.run ? String(options.run) : newestRunId());
  const runDirectory = join(maestroArtifactsRoot, runId);
  if (!existsSync(runDirectory)) throw new Error(`找不到 Maestro 运行：${runDirectory}`);
  if (!existsSync(logoPath) || !existsSync(regularFont)) {
    throw new Error('缺少 EchoWave Logo 或 Source Han Sans CN 字体。');
  }

  const outputDirectory = options.output
    ? resolve(String(options.output))
    : join(videoArtifactsRoot, runId);
  mkdirSync(outputDirectory, { recursive: true });
  const workDirectory = mkdtempSync(join(outputDirectory, '.work-'));
  const voice = String(options.voice ?? 'zh-CN-YunyangNeural');
  const maskOverlay = Boolean(options['mask-overlay']);

  const resolvedSections = resolveSectionVisuals(runDirectory);
  const missingSections = resolvedSections
    .filter((section) => section.visuals.length > 0 && section.selected.length === 0)
    .map((section) => section.titleZh);
  if (missingSections.length) {
    throw new Error(`以下章节没有可用截图：${missingSections.join('、')}`);
  }

  const assPath = join(outputDirectory, 'subtitles-zh-en.ass');
  const scriptPath = join(outputDirectory, 'video-script.md');
  const timelinePath = join(outputDirectory, 'command-timeline.json');
  const musicPath = join(outputDirectory, 'music-and-sfx.wav');
  const narrationPath = join(outputDirectory, 'narration-zh.wav');
  writeFileSync(assPath, renderShowcaseAss());
  writeFileSync(scriptPath, renderShowcaseScriptMarkdown());
  writeFileSync(timelinePath, `${JSON.stringify(extractCommandTimeline(runDirectory), null, 2)}\n`);
  writePcmWave(musicPath);

  const shots = buildShotSchedule(resolvedSections);
  const renderPlanPath = join(outputDirectory, 'render-plan.json');
  writeFileSync(
    renderPlanPath,
    `${JSON.stringify(
      {
        runId,
        outputDirectory,
        workDirectory,
        logoPath,
        regularFont,
        voice,
        maskOverlay,
        shots,
      },
      null,
      2,
    )}\n`,
  );
  if (options['prepare-assets']) {
    console.log(`Showcase 渲染计划已生成：${renderPlanPath}`);
    return;
  }

  const { ffmpeg, ffprobe } = await ensureFfmpeg(options);
  const python = resolvePython(options);
  const pythonEnv = ensureEdgeTts(python, options);
  const shotFiles = [];
  for (const [index, shot] of shots.entries()) {
    const path = join(workDirectory, `shot-${String(index + 1).padStart(2, '0')}.mp4`);
    renderShot(ffmpeg, shot, path, maskOverlay);
    shotFiles.push(path);
  }

  const concatPath = join(workDirectory, 'shots.txt');
  writeFileSync(
    concatPath,
    shotFiles
      .map((path) => `file '${path.replaceAll('\\', '/').replaceAll("'", "'\\''")}'`)
      .join('\n'),
  );
  const visualBasePath = join(workDirectory, 'visual-base.mp4');
  run(
    ffmpeg,
    [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      concatPath,
      '-t',
      String(SHOWCASE_DURATION_SECONDS),
      '-c',
      'copy',
      visualBasePath,
    ],
    { inherit: true },
  );

  const titledVisualPath = join(workDirectory, 'visual-titled.mp4');
  run(
    ffmpeg,
    [
      '-y',
      '-i',
      visualBasePath,
      '-vf',
      `ass='${ffmpegFilterPath(assPath)}':fontsdir='${ffmpegFilterPath(dirname(regularFont))}'`,
      '-t',
      String(SHOWCASE_DURATION_SECONDS),
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
      '-an',
      titledVisualPath,
    ],
    { inherit: true },
  );

  generateNarration({
    ffmpeg,
    python,
    pythonEnv,
    workDirectory,
    outputPath: narrationPath,
    voice,
  });

  const masterPath = join(outputDirectory, 'EchoWave-demo-zh-en-1080p.mp4');
  run(
    ffmpeg,
    [
      '-y',
      '-i',
      titledVisualPath,
      '-i',
      narrationPath,
      '-i',
      musicPath,
      '-filter_complex',
      '[1:a]volume=1.0[voice];[2:a]volume=0.50[music];[voice][music]amix=inputs=2:duration=longest:dropout_transition=0,loudnorm=I=-14:TP=-1.5:LRA=11[audio]',
      '-map',
      '0:v:0',
      '-map',
      '[audio]',
      '-t',
      String(SHOWCASE_DURATION_SECONDS),
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-b:a',
      '256k',
      '-movflags',
      '+faststart',
      masterPath,
    ],
    { inherit: true },
  );

  const cleanPath = join(outputDirectory, 'EchoWave-demo-clean-1080p.mp4');
  run(
    ffmpeg,
    [
      '-y',
      '-i',
      titledVisualPath,
      '-i',
      musicPath,
      '-filter_complex',
      '[1:a]volume=0.72,loudnorm=I=-18:TP=-1.5:LRA=11[audio]',
      '-map',
      '0:v:0',
      '-map',
      '[audio]',
      '-t',
      String(SHOWCASE_DURATION_SECONDS),
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-b:a',
      '256k',
      '-movflags',
      '+faststart',
      cleanPath,
    ],
    { inherit: true },
  );

  const thumbnailPath = join(outputDirectory, 'thumbnail.png');
  run(ffmpeg, ['-y', '-ss', '82', '-i', masterPath, '-frames:v', '1', thumbnailPath], {
    inherit: true,
  });

  const summary = JSON.parse(readFileSync(join(runDirectory, 'summary.json'), 'utf8'));
  const masterProbe = probeMedia(ffprobe, masterPath);
  const cleanProbe = probeMedia(ffprobe, cleanPath);
  validateShowcaseMediaProbe(masterProbe);
  validateShowcaseMediaProbe(cleanProbe);
  const audioLevels = analyzeAudioLevels(ffmpeg, masterPath);
  const videoStream = masterProbe.streams.find((stream) => stream.codec_type === 'video');
  const audioStream = masterProbe.streams.find((stream) => stream.codec_type === 'audio');
  const fallbackCount = resolvedSections.reduce(
    (total, section) => total + section.fallbacks.length,
    0,
  );
  const qa = {
    runId,
    generatedAt: new Date().toISOString(),
    status: 'completed',
    checks: {
      duration: {
        expectedSeconds: SHOWCASE_DURATION_SECONDS,
        actualSeconds: Number(masterProbe.format.duration),
        passed: Math.abs(Number(masterProbe.format.duration) - SHOWCASE_DURATION_SECONDS) <= 0.25,
      },
      dimensions: {
        expected: '1920x1080',
        actual: `${videoStream?.width}x${videoStream?.height}`,
        passed: videoStream?.width === 1920 && videoStream?.height === 1080,
      },
      audio: { passed: Boolean(audioStream), codec: audioStream?.codec_name ?? null },
      audioLevels,
      sourceFlows: {
        suite: summary.suite,
        flowStatus: summary.flowStatus ?? null,
        overallStatus: summary.status,
        passed: summary.flows?.every((flow) => flow.status === 'passed') ?? false,
      },
      showcaseFootage: {
        fallbackCount,
        passed: summary.suite === 'showcase' && fallbackCount === 0,
      },
      manualVisualReview: {
        passed: false,
        required: true,
        note: '发布前必须完整播放，确认无调试覆盖物、敏感信息、字幕遮挡、黑帧或超过 1.5 秒的无意义静止。',
      },
    },
    publishReady: false,
    note:
      summary.suite === 'showcase' && fallbackCount === 0
        ? '媒体技术检查完成；通过人工视觉复核后可发布。'
        : '这是使用 stable 降级素材生成的审阅版；真实 ASR/RAG Showcase 重录后才能标记为公开发布版。',
    probes: { master: masterProbe, clean: cleanProbe },
  };
  writeFileSync(join(outputDirectory, 'qa-report.json'), `${JSON.stringify(qa, null, 2)}\n`);

  const manifest = {
    runId,
    generatedAt: new Date().toISOString(),
    sourceDirectory: runDirectory,
    voice,
    durationSeconds: SHOWCASE_DURATION_SECONDS,
    maskOverlay,
    sections: resolvedSections.map((section) => ({
      start: section.start,
      end: section.end,
      titleZh: section.titleZh,
      sources: section.selected,
      fallbacks: section.fallbacks,
    })),
    outputs: {
      master: masterPath,
      clean: cleanPath,
      narration: narrationPath,
      musicAndSfx: musicPath,
      subtitles: assPath,
      script: scriptPath,
      thumbnail: thumbnailPath,
      commandTimeline: timelinePath,
    },
  };
  writeFileSync(
    join(outputDirectory, 'render-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  console.log(`Showcase 视频已生成：${masterPath}`);
  console.log(`QA 报告：${join(outputDirectory, 'qa-report.json')}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
