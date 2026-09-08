import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  SHOWCASE_DURATION_SECONDS,
  SHOWCASE_SCRIPT,
  assTimestamp,
  extractCommandTimeline,
  renderShowcaseAss,
  renderShowcaseScriptMarkdown,
  resolveSectionVisuals,
  validateShowcaseMediaProbe,
  validateShowcaseScript,
} from './showcase-video-lib.mjs';

test('showcase script is contiguous and exactly 150 seconds', () => {
  assert.equal(validateShowcaseScript(), true);
  assert.equal(SHOWCASE_SCRIPT.at(-1).end, SHOWCASE_DURATION_SECONDS);
  assert.throws(
    () => validateShowcaseScript([{ ...SHOWCASE_SCRIPT[0], start: 1 }]),
    /时间轴不连续/u,
  );
});

test('ASS output contains bilingual subtitles, stack card, and GitHub CTA', () => {
  const ass = renderShowcaseAss();
  assert.match(ass, /Style: Subtitle/u);
  assert.match(ass, /EchoWave，让每一段声音/u);
  assert.match(ass, /Turn every conversation/u);
  assert.match(ass, /PostgreSQL \/ pgvector/u);
  assert.match(ass, /github\.com\/MetaBrain-Labs\/EchoWave/u);
  assert.equal(assTimestamp(150), '0:02:30.00');
});

test('Markdown script remains suitable for replacing the draft narration', () => {
  const markdown = renderShowcaseScriptMarkdown();
  assert.match(markdown, /2 分 30 秒/u);
  assert.match(markdown, /中文旁白/u);
  assert.match(markdown, /English subtitle/u);
});

test('visual resolver prefers showcase captures and reports stable fallbacks', () => {
  const root = mkdtempSync(join(tmpdir(), 'echowave-showcase-'));
  const showcase = join(root, 'a', 'takeScreenshot', 'showcase');
  const stable = join(root, 'b', 'takeScreenshot', 'stable');
  mkdirSync(showcase, { recursive: true });
  mkdirSync(stable, { recursive: true });
  writeFileSync(join(showcase, '01-groups.png'), 'showcase');
  writeFileSync(join(stable, '01-knowledge.png'), 'stable');

  const [section] = resolveSectionVisuals(root, [
    {
      ...SHOWCASE_SCRIPT[1],
      visuals: [
        ['showcase/01-groups.png', 'stable/01-groups.png'],
        ['showcase/01-knowledge.png', 'stable/01-knowledge.png'],
      ],
    },
  ]);
  assert.equal(section.selected.length, 2);
  assert.equal(section.selected[0], join(showcase, '01-groups.png'));
  assert.deepEqual(section.fallbacks, [
    { expected: 'showcase/01-knowledge.png', selected: 'stable/01-knowledge.png' },
  ]);
});

test('visual resolver exposes missing required footage', () => {
  const root = mkdtempSync(join(tmpdir(), 'echowave-showcase-missing-'));
  const [section] = resolveSectionVisuals(root, [SHOWCASE_SCRIPT[1]]);
  assert.equal(section.selected.length, 0);
  assert.equal(section.visuals.length, 3);
});

test('media probe validation rejects missing audio, bad duration, and wrong encoding', () => {
  const valid = {
    format: { duration: '150.01' },
    streams: [
      { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080 },
      { codec_type: 'audio', codec_name: 'aac' },
    ],
  };
  assert.equal(validateShowcaseMediaProbe(valid).audio.codec_name, 'aac');
  assert.throws(
    () => validateShowcaseMediaProbe({ ...valid, streams: valid.streams.slice(0, 1) }),
    /缺少音轨/u,
  );
  assert.throws(
    () => validateShowcaseMediaProbe({ ...valid, format: { duration: '149' } }),
    /时长/u,
  );
  assert.throws(
    () =>
      validateShowcaseMediaProbe({
        ...valid,
        streams: [{ ...valid.streams[0], codec_name: 'vp9' }, valid.streams[1]],
      }),
    /H\.264/u,
  );
});

test('command timeline starts at recording and classifies removable waits', () => {
  const root = mkdtempSync(join(tmpdir(), 'echowave-commands-'));
  const flow = join(root, 'flows', 'sample');
  mkdirSync(flow, { recursive: true });
  writeFileSync(
    join(flow, 'commands.json'),
    JSON.stringify([
      {
        command: { launchAppCommand: {} },
        metadata: { depth: 0, timestamp: 100, duration: 5000, status: 'COMPLETED' },
      },
      {
        command: { startRecordingCommand: {} },
        metadata: { depth: 0, timestamp: 1000, duration: 10, status: 'COMPLETED' },
      },
      {
        command: { assertConditionCommand: {} },
        metadata: { depth: 0, timestamp: 2000, duration: 2500, status: 'COMPLETED' },
      },
    ]),
  );

  const [timeline] = extractCommandTimeline(root);
  assert.equal(timeline.commands[0].atMs, 0);
  assert.equal(timeline.commands[1].atMs, 1000);
  assert.equal(timeline.removableWaits[0].action, 'assertConditionCommand');
});
