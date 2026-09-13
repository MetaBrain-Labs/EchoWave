/**
 * 宣传片剪辑回归：防止素材误选、越界、帧数和缓存错误。
 * 使用极小本地夹具，不启动 App，不调用外部供应商。
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  cacheFingerprint,
  renderShotAss,
  resolveFootage,
  scheduleShots,
  validateShowcaseMediaProbe,
  validateTimeline,
} from './showcase-video-lib.mjs';
import { createTimeline, SELECTED_FILES } from '../showcase/timeline.mjs';
import { cameraFrames, sampleCamera } from '../showcase/camera.mjs';

const probes = Object.fromEntries(
  Object.keys(SELECTED_FILES).map((id) => [
    id,
    { format: { duration: 240 }, streams: [{ codec_type: 'video', width: 1080, height: 2400 }] },
  ]),
);
test('explicit selection supports multiple roots and ignores new unselected clips', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'echowave-edit-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const a = join(root, 'showcase'),
    b = join(root, 'retake');
  mkdirSync(a);
  mkdirSync(b);
  writeFileSync(join(a, 'input.mp4'), 'fixture');
  writeFileSync(join(b, 'result.mp4'), 'fixture');
  writeFileSync(join(b, 'unused.mp4'), 'fixture');
  const result = resolveFootage([a, b], { input: 'input.mp4', result: 'result.mp4' });
  assert.equal(result.files.length, 3);
  assert.equal(Object.keys(result.selected).length, 2);
  assert.throws(() => resolveFootage([a, b], { missing: 'absent.mp4' }), /必须唯一/u);
  writeFileSync(join(a, 'result.mp4'), 'duplicate');
  assert.throws(() => resolveFootage([a, b], { result: 'result.mp4' }), /必须唯一/u);
});
test('76 seconds includes overlap and speed is derived from source time', () => {
  const shots = createTimeline();
  assert.equal(validateTimeline(shots, probes), true);
  assert.equal(
    shots.reduce((n, s) => n + s.frames - s.overlap, 0),
    2280,
  );
  for (const shot of shots.filter((s) => s.source))
    assert.ok(Math.abs((shot.frames / 30) * shot.speed - (shot.out - shot.in)) < 1e-9);
  const pair = scheduleShots([{ seconds: 2, transitionFrames: 12 }, { seconds: 3 }]);
  assert.equal(pair[0].frames, 72);
  assert.equal(pair[1].startFrame, 60);
  assert.equal(pair[1].overlap, 0);
});
test('source bounds, crop bounds and invalid overlaps are rejected', () => {
  const change = (delta) => {
    const shots = createTimeline();
    Object.assign(shots[0], delta);
    return shots;
  };
  assert.throws(() => validateTimeline(change({ in: -1 }), probes), /源片区间/u);
  assert.throws(() => validateTimeline(change({ out: 241 }), probes), /源片区间/u);
  assert.throws(
    () => validateTimeline(change({ bounds: [1000, 0, 1000, 500] }), probes),
    /裁切越界/u,
  );
  assert.throws(
    () => validateTimeline(change({ bounds: [0, 2399, 400, 100] }), probes),
    /裁切越界/u,
  );
  assert.throws(() => validateTimeline(change({ overlap: 65 }), probes), /重叠/u);
  assert.throws(() => validateTimeline(change({ frames: 60.5 }), probes), /帧数/u);
});
test('source, crop, font and sound changes invalidate cache identity', () => {
  const data = { source: 'sha-a', crop: [0, 10, 100], font: 'font-a', sound: { bpm: 90 } };
  const original = cacheFingerprint(data);
  assert.equal(original, cacheFingerprint(structuredClone(data)));
  for (const update of [
    { source: 'sha-b' },
    { crop: [0, 20, 100] },
    { font: 'font-b' },
    { sound: { bpm: 96 } },
  ])
    assert.notEqual(original, cacheFingerprint({ ...data, ...update }));
});
const media = {
  format: { duration: '76' },
  streams: [
    {
      codec_type: 'video',
      codec_name: 'h264',
      width: 1920,
      height: 1080,
      pix_fmt: 'yuv420p',
      avg_frame_rate: '30/1',
      nb_frames: '2280',
    },
    { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000' },
  ],
};
test('delivery requires exact frames, 30fps, compatible H264 and AAC audio', () => {
  assert.equal(validateShowcaseMediaProbe(media).duration, 76);
  assert.throws(
    () => validateShowcaseMediaProbe({ ...media, streams: media.streams.slice(0, 1) }),
    /音轨/u,
  );
  for (const change of [
    { codec_name: 'hevc' },
    { pix_fmt: 'yuv444p' },
    { nb_frames: '2279' },
    { avg_frame_rate: '25/1' },
  ])
    assert.throws(() =>
      validateShowcaseMediaProbe({
        ...media,
        streams: [{ ...media.streams[0], ...change }, media.streams[1]],
      }),
    );
});
test('titles are short, bilingual and no tutorial subtitle track is generated', () => {
  const shots = createTimeline();
  const title = renderShotAss(shots.find((s) => s.id === '06-transcript'));
  assert.match(title, /也理解上下文/u);
  assert.match(title, /VOICE, IN CONTEXT/u);
  assert.doesNotMatch(title, /Style: Subtitle/u);
  assert.match(renderShotAss(shots.at(-1)), /github.com\/MetaBrain-Labs\/EchoWave/u);
});

test('camera motion preserves subpixel positions, aspect and held endpoints', () => {
  const keys = [
    [0, 1, 540, 800, 960, 540],
    [2, 1.8, 540, 1250, 960, 540],
  ];
  assert.deepEqual(sampleCamera(keys, 0), keys[0].slice(1));
  assert.deepEqual(sampleCamera(keys, 3), keys[1].slice(1));
  const poses = cameraFrames({ cameras: keys, frames: 61 });
  assert.ok(poses[1][2] % 1 !== 0);
  for (let i = 1; i < poses.length; i++) {
    assert.ok(poses[i][0] >= poses[i - 1][0]);
    assert.ok(poses[i][2] >= poses[i - 1][2]);
  }
  assert.ok(poses[1][0] - poses[0][0] < poses[30][0] - poses[29][0]);
});

test('three heroes contain continuous interactions and only six title groups', () => {
  const shots = createTimeline();
  assert.deepEqual([...new Set(shots.filter((s) => s.hero).map((s) => s.hero))], [1, 2, 3]);
  assert.equal(shots.filter((s) => s.title || s.brand || s.kind === 'stack').length, 6);
  const transcript = shots.find((s) => s.hero === 1);
  assert.ok(transcript.in < 10 && transcript.out > 14);
  const knowledge = shots.find((s) => s.hero === 3);
  assert.equal(knowledge.in, 0);
  assert.ok(knowledge.out >= 17.5);
  assert.ok(shots.filter((s) => s.source).every((s) => !s.from && !s.to));
  assert.ok(shots.filter((s) => s.source === 'input').every((s) => s.out < 90 || s.in >= 106));
});
