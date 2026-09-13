/**
 * 真实录屏宣传片渲染入口。
 * 统一 Node / PowerShell 路径，生成独立产物与可追溯剪辑清单；不更改原始素材。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cacheFingerprint,
  FPS,
  SHOWCASE_DURATION_SECONDS,
  renderShotAss,
  resolveFootage,
  TOTAL_FRAMES,
  validateShowcaseMediaProbe,
  validateTimeline,
} from '../e2e/showcase-video-lib.mjs';
import { createTimeline, SELECTED_FILES, SOURCE_ROOTS } from './timeline.mjs';
import { cameraFrames } from './camera.mjs';
import { homedir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2).filter((arg) => arg !== '--');
const option = (key) => {
  const index = args.indexOf(key);
  return index < 0 ? null : args[index + 1];
};
const output = resolve(
  root,
  option('--output') ?? '.artifacts/showcase-video/LAUNCH_REFINED_20260913',
);
const cache = join(output, '.cache');
const python =
  option('--python') ??
  join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
const musicConfigPath = option('--music-config');
const musicConfig = musicConfigPath
  ? JSON.parse(readFileSync(resolve(root, musicConfigPath), 'utf8').replace(/^\uFEFF/u, ''))
  : null;
const fontDir = join(root, 'apps/mobile/assets/fonts');
const logo = join(root, 'apps/mobile/assets/img/icon.png');
const json = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
const filterPath = (path) =>
  path.replaceAll('\\', '/').replace(':', '\\:').replaceAll("'", "'\\''");

function filesBelow(dir, name) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? filesBelow(join(dir, entry.name), name)
      : entry.name === name
        ? [join(dir, entry.name)]
        : [],
  );
}
const ffmpeg = option('--ffmpeg') ?? filesBelow(join(root, '.artifacts/tools'), 'ffmpeg.exe')[0];
const ffprobe = option('--ffprobe') ?? filesBelow(join(root, '.artifacts/tools'), 'ffprobe.exe')[0];

/** 使用参数数组执行媒体命令，完整诊断保存本地，避免 shell 路径转义问题。 */
function run(command, commandArgs, logName = 'media') {
  // Windows 受限环境不允许子进程匿名管道，直接写文件仍使用同一执行边界。
  const stdoutPath = join(cache, `${logName}.stdout.log`);
  const stderrPath = join(cache, `${logName}.log`);
  const outFd = openSync(stdoutPath, 'w'),
    errFd = openSync(stderrPath, 'w');
  let result;
  try {
    result = spawnSync(command, commandArgs, {
      cwd: root,
      stdio: ['ignore', outFd, errFd],
      windowsHide: true,
    });
  } finally {
    closeSync(outFd);
    closeSync(errFd);
  }
  const stdout = readFileSync(stdoutPath, 'utf8'),
    stderr = readFileSync(stderrPath, 'utf8');
  if (result.error || result.status !== 0)
    throw new Error(`${logName} 失败：${result.error?.message ?? stderr.slice(-2500)}`);
  return `${stdout}\n${stderr}`;
}
function probe(path) {
  return JSON.parse(
    run(
      ffprobe,
      ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', path],
      'probe',
    ).trim(),
  );
}
const hashFile = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

/** 渐变在大画布上生成，渲染时轻微平移，避免重复静态背景。 */
function background(path) {
  const width = 2080,
    height = 1200;
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const blue = Math.exp(-((x - 500) ** 2 / 700000 + (y - 380) ** 2 / 240000));
      const violet = Math.exp(-((x - 1720) ** 2 / 350000 + (y - 900) ** 2 / 280000));
      const index = (y * width + x) * 3;
      pixels[index] = Math.round(3 + 6 * blue + 17 * violet);
      pixels[index + 1] = Math.round(8 + 17 * blue + 4 * violet);
      pixels[index + 2] = Math.round(22 + 28 * blue + 25 * violet);
    }
  writeFileSync(path, Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), pixels]));
}
/** 单镜头保持源时间戳，通过镜头关键帧引导视线，不重绘界面。 */
function renderShot(shot, plan, signature, bgPath) {
  const key = cacheFingerprint({ signature, shot, source: plan.hashes[shot.source] });
  const target = join(cache, `${shot.id}-${key.slice(0, 16)}.mp4`);
  if (existsSync(target) && Number(probe(target).streams[0].nb_frames) === shot.frames)
    return target;
  const ass = join(cache, `${shot.id}.ass`);
  writeFileSync(ass, renderShotAss(shot));
  const input = ['-loop', '1', '-framerate', '30', '-i', bgPath];
  const filters = [
    `[0:v]crop=1920:1080:x='80+35*sin(t*0.24+${shot.startFrame / FPS})':y='60+22*cos(t*0.2)',setsar=1[bg]`,
  ];
  if (shot.source) {
    const configPath = join(cache, `${shot.id}-camera.json`);
    json(configPath, {
      shot,
      poses: cameraFrames(shot),
      ffmpeg,
      source: plan.selected[shot.source],
      target,
      ass,
      fonts: fontDir,
      background: bgPath,
      logo,
    });
    console.log(`渲染交互镜头 ${shot.id} (${shot.frames} 帧)`);
    run(python, [join(root, 'scripts/showcase/composite.py'), configPath], shot.id);
    if (Number(probe(target).streams[0].nb_frames) !== shot.frames)
      throw new Error(`镜头帧数不足：${shot.id}`);
    return target;
  } else if (shot.kind === 'brand') {
    input.push('-loop', '1', '-framerate', '30', '-i', logo);
    filters.push('[1:v]scale=320:320:flags=lanczos,format=rgba[logo]');
    filters.push('[bg][logo]overlay=x=800:y=150[visual]');
  } else filters.push('[bg]null[visual]');
  filters.push(
    `[visual]ass='${filterPath(ass)}':fontsdir='${filterPath(fontDir)}',format=yuv420p[out]`,
  );
  const graph = join(cache, `${shot.id}.filter`);
  writeFileSync(graph, filters.join(';\n'));
  console.log(`渲染 ${shot.id} (${shot.frames} 帧)`);
  run(
    ffmpeg,
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'warning',
      '-filter_complex_threads',
      '2',
      ...input,
      '-filter_complex_script',
      graph,
      '-map',
      '[out]',
      '-an',
      '-frames:v',
      String(shot.frames),
      '-r',
      '30',
      '-c:v',
      'libx264',
      '-threads',
      '4',
      '-preset',
      'fast',
      '-crf',
      '14',
      '-pix_fmt',
      'yuv420p',
      target,
    ],
    shot.id,
  );
  if (Number(probe(target).streams[0].nb_frames) !== shot.frames)
    throw new Error(`镜头帧数不足：${shot.id}`);
  return target;
}

/** 两输入 blend 兼容本机旧版 FFmpeg；重叠的头尾不再进入主体。 */
function assemble(shots, paths, target) {
  const filters = [],
    order = [];
  shots.forEach((shot, i) => {
    const head = i > 0 ? shots[i - 1].overlap : 0;
    const branches = ['body', ...(head ? ['head'] : []), ...(shot.overlap ? ['tail'] : [])];
    filters.push(
      `[${i}:v]split=${branches.length}${branches.map((part) => `[s${i}${part}]`).join('')}`,
    );
    filters.push(
      `[s${i}body]trim=start_frame=${head}:end_frame=${shot.frames - shot.overlap},setpts=PTS-STARTPTS[b${i}]`,
    );
    if (head) {
      filters.push(`[s${i}head]trim=end_frame=${head},setpts=PTS-STARTPTS[h${i}]`);
      filters.push(
        `[t${i - 1}][h${i}]blend=all_expr='${shots[i - 1].transition === 'wipe' ? `if(lte(X,W*(N/${head})*(N/${head})*(3-2*N/${head})),B,A)` : `A*(1-min(N/${head},1))+B*min(N/${head},1)`}':shortest=1[x${i}]`,
      );
      order.push(`[x${i}]`);
    }
    order.push(`[b${i}]`);
    if (shot.overlap)
      filters.push(
        `[s${i}tail]trim=start_frame=${shot.frames - shot.overlap},setpts=PTS-STARTPTS[t${i}]`,
      );
  });
  filters.push(`${order.join('')}concat=n=${order.length}:v=1:a=0,format=yuv420p[out]`);
  const graph = join(cache, `${basename(target)}.filter`);
  writeFileSync(graph, filters.join(';\n'));
  run(
    ffmpeg,
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'warning',
      '-filter_complex_threads',
      '2',
      ...paths.flatMap((path) => ['-threads', '1', '-i', path]),
      '-filter_complex_script',
      graph,
      '-map',
      '[out]',
      '-an',
      '-r',
      '30',
      '-c:v',
      'libx264',
      '-threads',
      '4',
      '-preset',
      'medium',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      target,
    ],
    `assemble-${basename(target)}`,
  );
}

function measure(path, name) {
  const outputText = run(
    ffmpeg,
    [
      '-hide_banner',
      '-nostats',
      '-i',
      path,
      '-af',
      'loudnorm=I=-16:TP=-1.5:LRA=9:print_format=json',
      '-f',
      'null',
      'NUL',
    ],
    name,
  );
  return JSON.parse(outputText.slice(outputText.lastIndexOf('{'), outputText.lastIndexOf('}') + 1));
}

async function main() {
  if (args.includes('--help')) {
    console.log(
      'pnpm showcase:video -- [--output directory] [--prepare-assets | --heroes | --qa-only] [--ffmpeg path --ffprobe path]',
    );
    return;
  }
  if (args.some((arg) => ['--run', '--voice', '--mask-overlay', '--prepare-tools'].includes(arg)))
    throw new Error('旧版自动截图/TTS 参数已退役，请使用 --help 查看显式剪辑入口。');
  if (!ffmpeg || !ffprobe)
    throw new Error('缺少 FFmpeg/FFprobe，请通过 --ffmpeg 与 --ffprobe 指定现有工具。');
  mkdirSync(cache, { recursive: true });
  const library = resolveFootage(
    SOURCE_ROOTS.map((name) => join(root, '.artifacts/maestro', name)),
    SELECTED_FILES,
  );
  const shots = createTimeline();
  const probes = Object.fromEntries(
    Object.entries(library.selected).map(([id, path]) => [id, probe(path)]),
  );
  validateTimeline(shots, probes);
  const hashes = Object.fromEntries(
    Object.entries(library.selected).map(([id, path]) => [id, hashFile(path)]),
  );
  const signature = cacheFingerprint({
    code: ['render-video.mjs', 'camera.mjs', 'composite.py'].map((name) =>
      hashFile(join(root, 'scripts/showcase', name)),
    ),
    lib: hashFile(join(root, 'scripts/e2e/showcase-video-lib.mjs')),
    fonts: ['SourceHanSansCN-Regular.otf', 'SourceHanSansCN-Bold.otf'].map((name) =>
      hashFile(join(fontDir, name)),
    ),
    logo: hashFile(logo),
    ffmpeg: hashFile(ffmpeg),
  });
  const plan = {
    version: 3,
    signature,
    fps: FPS,
    frames: TOTAL_FRAMES,
    durationSeconds: SHOWCASE_DURATION_SECONDS,
    selected: library.selected,
    hashes,
    shots,
    sound: musicConfig,
    soundEvents: [],
    continuousPlaybackReview: 'not performed; only sequence-frame review is available',
  };
  json(join(output, 'render-plan.json'), plan);
  json(
    join(output, 'footage-library.json'),
    library.files.map((file) => ({
      ...file,
      selected: Object.values(library.selected).includes(file.path),
      reason: Object.values(library.selected).includes(file.path)
        ? '人工选择窗口，见 shot-list'
        : '不进入主剪：导航、配置、归档、测试/调试覆盖物或重复内容',
    })),
  );
  writeFileSync(
    join(output, 'shot-list.md'),
    `# EchoWave / From Voice to Insight\n\n76 秒 · 1920×1080 · 30fps · 无连续旁白\n\n| 成片时间 | 镜头 | 来源 | 源入点–出点 | 速度 | 帧数 / 尾部重叠 |\n| --- | --- | --- | --- | --- | --- |\n${shots.map((shot) => `| ${(shot.startFrame / FPS).toFixed(2)}–${((shot.startFrame + shot.frames - shot.overlap) / FPS).toFixed(2)} | ${shot.title ?? shot.kind} | ${shot.source ?? '品牌资产'} | ${shot.source ? `${shot.in}–${shot.out}` : '—'} | ${shot.speed.toFixed(3)}× | ${shot.frames} / ${shot.overlap} |`).join('\n')}\n\n素材保留原 UI、提示、置信度与状态。来源之间的剪切不表示同一次实时任务。连续播放与主观听感审片尚未完成。\n`,
  );
  if (args.includes('--prepare-assets')) {
    console.log(`计划已校验：${output}`);
    return;
  }
  const bgPath = join(cache, 'background.ppm');
  background(bgPath);
  const master = join(
    output,
    musicConfig ? 'EchoWave-launch-zh-en-1080p.mp4' : 'EchoWave-launch-visual-preview-1080p.mp4',
  );
  if (!args.includes('--qa-only')) {
    const subset = args.includes('--heroes') ? shots.filter((shot) => shot.hero) : shots;
    const rendered = new Map(
      subset.map((shot) => [shot.id, renderShot(shot, plan, signature, bgPath)]),
    );
    if (args.includes('--heroes')) {
      for (const [name, ids] of [
        ['hero-1', ['06-transcript']],
        ['hero-2', ['07-positive', '08-improve']],
        ['hero-3', ['09-knowledge']],
      ]) {
        const group = ids.map((id) => ({ ...shots.find((shot) => shot.id === id) }));
        // 预览末镜头保留完整尾部，不引用未渲染的下一镜头。
        group[group.length - 1].overlap = 0;
        assemble(
          group,
          ids.map((id) => rendered.get(id)),
          join(output, `${name}-1080p.mp4`),
        );
      }
      console.log(`三个 Hero 审阅片已输出：${output}`);
      return;
    }
    const editHash = cacheFingerprint({ signature, shots, hashes });
    const visual = join(cache, `visual-${editHash.slice(0, 16)}.mp4`);
    if (!existsSync(visual))
      assemble(
        shots,
        shots.map((shot) => rendered.get(shot.id)),
        visual,
      );
    const music = join(output, 'music-and-sfx.wav');
    if (!musicConfig) {
      run(
        ffmpeg,
        ['-y', '-v', 'error', '-i', visual, '-c', 'copy', '-movflags', '+faststart', master],
        'silent-preview',
      );
      json(join(output, 'render-manifest.json'), {
        signature,
        master,
        frames: TOTAL_FRAMES,
        durationSeconds: SHOWCASE_DURATION_SECONDS,
        music: 'missing licensed source; silent visual preview only',
      });
    } else {
      if (
        !musicConfig.file ||
        !musicConfig.title ||
        !musicConfig.artist ||
        !musicConfig.license ||
        !musicConfig.source
      )
        throw new Error('音乐配置必须包含 file/title/artist/license/source');
      const musicSource = resolve(root, musicConfig.file);
      const musicProbe = probe(musicSource);
      if (!musicProbe.streams.some((stream) => stream.codec_type === 'audio'))
        throw new Error('音乐没有音轨');
      if (Number(musicProbe.format.duration) < (musicConfig.start ?? 0) + SHOWCASE_DURATION_SECONDS)
        throw new Error('音乐区间不足');
      run(
        ffmpeg,
        [
          '-y',
          '-v',
          'error',
          '-ss',
          String(musicConfig.start ?? 0),
          '-i',
          musicSource,
          '-t',
          String(SHOWCASE_DURATION_SECONDS),
          '-af',
          'afade=t=in:d=0.6,afade=t=out:st=73:d=3',
          '-ar',
          '48000',
          '-ac',
          '2',
          music,
        ],
        'licensed-music',
      );
      json(join(output, 'music-license.json'), {
        ...musicConfig,
        sha256: hashFile(musicSource),
        edits: 'excerpt, fade in/out, loudness normalization',
      });
      const levels = measure(music, 'music-measure');
      const norm = `loudnorm=I=-16:TP=-1.5:LRA=9:measured_I=${levels.input_i}:measured_TP=${levels.input_tp}:measured_LRA=${levels.input_lra}:measured_thresh=${levels.input_thresh}:offset=${levels.target_offset}:linear=true`;
      run(
        ffmpeg,
        [
          '-y',
          '-hide_banner',
          '-i',
          visual,
          '-i',
          music,
          '-map',
          '0:v:0',
          '-map',
          '1:a:0',
          '-af',
          norm,
          '-c:v',
          'copy',
          '-c:a',
          'aac',
          '-b:a',
          '256k',
          '-ar',
          '48000',
          '-t',
          String(SHOWCASE_DURATION_SECONDS),
          '-movflags',
          '+faststart',
          master,
        ],
        'master',
      );
    }
  }
  const media = probe(master);
  validateShowcaseMediaProbe(media, SHOWCASE_DURATION_SECONDS, Boolean(musicConfig));
  const levels = musicConfig ? measure(master, 'master-levels') : null;
  const scan = run(
    ffmpeg,
    [
      '-hide_banner',
      '-nostats',
      '-xerror',
      '-i',
      master,
      '-vf',
      'blackdetect=d=0.033:pix_th=0.05:pic_th=0.98,freezedetect=n=-50dB:d=2',
      '-an',
      '-f',
      'null',
      'NUL',
    ],
    'visual-qa',
  );
  const black = scan.split('\n').filter((line) => line.includes('black_start:'));
  const freezes = scan.split('\n').filter((line) => /freeze_(start|end|duration):/u.test(line));
  run(
    ffmpeg,
    [
      '-y',
      '-v',
      'error',
      '-ss',
      '38',
      '-i',
      master,
      '-frames:v',
      '1',
      join(output, 'thumbnail.png'),
    ],
    'thumbnail',
  );
  run(
    ffmpeg,
    [
      '-y',
      '-v',
      'error',
      '-i',
      master,
      '-vf',
      'fps=1/3,scale=480:270,tile=4x8',
      '-frames:v',
      '1',
      join(output, 'review-contact-sheet.jpg'),
    ],
    'contact-sheet',
  );
  const qa = {
    generatedAt: new Date().toISOString(),
    media,
    audio: levels
      ? {
          integratedLufs: Number(levels.input_i),
          truePeakDbtp: Number(levels.input_tp),
          passed: Math.abs(Number(levels.input_i) + 16) < 1 && Number(levels.input_tp) <= -1.5,
        }
      : { passed: false, reason: 'Missing licensed audio; visual preview only' },
    blackFrames: { passed: black.length === 0, events: black },
    freezeCandidates: freezes,
    decodedWithoutError: true,
    manualSequenceReview: { status: 'pending', notes: [] },
    continuousPlaybackAndListening: {
      passed: false,
      note: '未进行连续完整播放及主观听感检查；不以抽帧和响度检测代替。',
    },
    publishReady: false,
  };
  json(join(output, 'qa-report.json'), qa);
  json(join(output, 'render-manifest.json'), {
    signature,
    frames: TOTAL_FRAMES,
    durationSeconds: SHOWCASE_DURATION_SECONDS,
    master,
    plan: join(output, 'render-plan.json'),
    thumbnail: join(output, 'thumbnail.png'),
    qa: join(output, 'qa-report.json'),
  });
  if ((musicConfig && !qa.audio.passed) || black.length)
    throw new Error('成片 QA 存在音频或黑帧问题，查看 qa-report.json');
  console.log(
    `${musicConfig ? '有声成片技术检查通过' : '无声画面审阅版检查通过；授权音源待提供'}：${master}`,
  );
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
