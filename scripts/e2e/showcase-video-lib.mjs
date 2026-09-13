/**
 * 宣传片剪辑契约与校验。
 * 仅管理媒体、整数帧时间轴和构图，不读取或修改产品业务数据。
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { validateCamera } from '../showcase/camera.mjs';

export const FPS = 30;
export const SHOWCASE_DURATION_SECONDS = 76;
export const TOTAL_FRAMES = FPS * SHOWCASE_DURATION_SECONDS;

/** 显式选择文件；未选素材只进入素材库，不会自动成为镜头。 */
export function resolveFootage(roots, selectedNames) {
  const files = [];
  const walk = (dir) => {
    if (!existsSync(dir)) throw new Error(`素材目录不存在：${dir}`);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.mp4$/iu.test(entry.name)) files.push({ name: entry.name, path: resolve(path) });
    }
  };
  roots.forEach(walk);
  const selected = Object.fromEntries(
    Object.entries(selectedNames).map(([id, name]) => {
      const matches = files.filter((file) => file.name === name);
      if (matches.length !== 1) throw new Error(`素材必须唯一：${name}，找到 ${matches.length} 个`);
      return [id, matches[0].path];
    }),
  );
  return { files, selected };
}

/** 每个镜头的尾部包含下一镜头的重叠区间，总长按整数帧核算。 */
export function scheduleShots(shots) {
  let cursor = 0;
  return shots.map((shot, index) => {
    const overlap = index < shots.length - 1 ? (shot.transitionFrames ?? 8) : 0;
    const frames = shot.seconds * FPS + overlap;
    const result = {
      ...shot,
      startFrame: cursor,
      frames,
      overlap,
      speed: shot.source ? (shot.out - shot.in) / (frames / FPS) : 1,
    };
    cursor += frames - overlap;
    return result;
  });
}

/** 校验来源区间、裁切边界和总帧数，禁止静默钳位产生错误画面。 */
export function validateTimeline(shots, probes, expectedFrames = TOTAL_FRAMES) {
  let cursor = 0;
  for (const [index, shot] of shots.entries()) {
    if (!Number.isInteger(shot.frames) || shot.frames <= 0 || shot.startFrame !== cursor)
      throw new Error('时间轴帧数不连续');
    if (
      !Number.isInteger(shot.overlap) ||
      shot.overlap < 0 ||
      shot.overlap >= shot.frames / 2 ||
      (index === shots.length - 1 && shot.overlap !== 0)
    )
      throw new Error('非法转场重叠');
    cursor += shot.frames - shot.overlap;
    if (!shot.source) continue;
    const probe = probes[shot.source];
    const video = probe?.streams?.find((stream) => stream.codec_type === 'video');
    if (
      !video ||
      !Number.isFinite(shot.in) ||
      !Number.isFinite(shot.out) ||
      shot.in < 0 ||
      shot.out <= shot.in ||
      shot.out > Number(probe.format.duration)
    )
      throw new Error(`源片区间越界：${shot.id}`);
    if (!Number.isFinite(shot.speed) || shot.speed <= 0) throw new Error('非法速度');
    validateCamera(shot, video.width, video.height);
  }
  if (cursor !== expectedFrames) throw new Error(`成片帧数错误：${cursor}，期望 ${expectedFrames}`);
  return true;
}

/** 缓存包含素材内容、字体、剪点、构图和渲染实现版本。 */
export function cacheFingerprint(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** 媒体技术门禁不替代连续播放和主观听感审片。 */
export function validateShowcaseMediaProbe(
  probe,
  expectedDuration = SHOWCASE_DURATION_SECONDS,
  requireAudio = true,
) {
  const duration = Number(probe?.format?.duration);
  const video = probe?.streams?.find((stream) => stream.codec_type === 'video');
  const audio = probe?.streams?.find((stream) => stream.codec_type === 'audio');
  if (!Number.isFinite(duration) || Math.abs(duration - expectedDuration) > 1 / FPS + 0.01)
    throw new Error('成片时长错误');
  if (
    !video ||
    video.width !== 1920 ||
    video.height !== 1080 ||
    video.codec_name !== 'h264' ||
    video.pix_fmt !== 'yuv420p'
  )
    throw new Error('成片必须为 1920×1080 H.264 yuv420p');
  const [num, den] = String(video.avg_frame_rate).split('/').map(Number);
  if (num / den !== FPS) throw new Error('成片必须为 30fps');
  if (Number(video.nb_frames) !== Math.round(expectedDuration * FPS))
    throw new Error('成片帧数错误');
  if (requireAudio && (!audio || audio.codec_name !== 'aac' || Number(audio.sample_rate) !== 48000))
    throw new Error('成片缺少 48kHz AAC 音轨');
  return { duration, video, audio };
}

export function assTimestamp(seconds) {
  const n = Math.round(seconds * 100);
  return `0:${String(Math.floor(n / 6000)).padStart(2, '0')}:${String(Math.floor(n / 100) % 60).padStart(2, '0')}.${String(n % 100).padStart(2, '0')}`;
}

/** 标题只承担单个重点；无常驻底部解释性字幕。 */
export function renderShotAss(shot) {
  const end = assTimestamp(shot.frames / FPS);
  const lines = [];
  const add = (style, x, y, text, size, start = 0, finish = end) => {
    if (/[{}\\]/u.test(text)) throw new Error('标题含不支持的 ASS 控制字符');
    lines.push(
      `Dialogue: 0,${assTimestamp(start)},${finish},${style},,0,0,0,,{\\pos(${x},${y})\\fs${size}\\fad(180,140)}${text}`,
    );
  };
  if (shot.brand) {
    add('Center', 960, 365, 'EchoWave', 144);
    add('Center', 960, 550, '从声音到洞察', 76);
    add('LabelCenter', 960, 660, 'FROM VOICE TO INSIGHT', 48);
  } else if (shot.kind === 'brand') {
    add('Center', 960, 565, 'EchoWave', 144);
    add('Center', 960, 718, shot.ending ? 'From Voice to Insight.' : '从声音到洞察', 60);
    if (shot.ending) {
      add('LabelCenter', 960, 836, 'Open Source on GitHub', 52);
      add('Center', 960, 902, 'github.com/MetaBrain-Labs/EchoWave', 60);
    } else add('LabelCenter', 960, 813, 'FROM VOICE TO INSIGHT', 34);
  } else if (shot.kind === 'stack') {
    add('Center', 960, 280, 'Built in the open.', 112);
    add(
      'LabelCenter',
      960,
      480,
      'React Native   /   Expo   /   TypeScript',
      48,
      0.5,
      assTimestamp(3.2),
    );
    add('LabelCenter', 960, 610, 'Node.js   /   LangGraph', 48, 1.2);
    add('LabelCenter', 960, 740, 'PostgreSQL   /   pgvector', 48, 2.4);
  } else if (shot.title) {
    const [x, y] = shot.titlePosition ?? [110, 80];
    const start = shot.titleFrom ?? 0;
    const finish = assTimestamp(shot.titleUntil ?? shot.seconds);
    const titleLines = shot.title.split('\n');
    titleLines.forEach((line, i) => add('Title', x, y + i * 115, line, 88, start, finish));
    add('Label', x + 2, y + titleLines.length * 115 + 15, shot.label, 44, start, finish);
  }
  const style = (name, size, color, bold, align, spacing) =>
    `Style: ${name},Source Han Sans CN,${size},${color},&H00FFFFFF,&H00000000,&H00000000,${bold},0,0,0,100,100,${spacing},0,1,0,0,${align},0,0,0,1`;
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\nScaledBorderAndShadow: yes\nWrapStyle: 2\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n${[
    style('Title', 80, '&H00FFFFFF', -1, 7, 0),
    style('Label', 36, '&H00D9BBA6', 0, 7, 2),
    style('Center', 112, '&H00FFFFFF', -1, 8, 0),
    style('LabelCenter', 36, '&H00D9BBA6', 0, 8, 1),
  ].join(
    '\n',
  )}\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${lines.join('\n')}\n`;
}
