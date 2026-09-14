/**
 * 案例媒体持久化与恢复回归。
 *
 * 验证裁剪范围、源文件清理后的播放、确定键恢复和路径边界。
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, unlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { CaseMediaStore } from '../../../dist/knowledge/collection/media.js';
import { CollectionService } from '../../../dist/knowledge/collection/service.js';
test('independent media retains exact turn bounds after source removal and recovers without duplication', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'echowave-case-'));
  const audioDirectory = path.join(root, 'audio');
  const tempDirectory = path.join(root, 'temp');
  const sourcePath = path.join(audioDirectory, 'source.wav');
  const store = new CaseMediaStore({
    knowledgeDirectory: path.join(root, 'knowledge'),
    audioDirectory,
    tempDirectory,
    ffmpegPath: 'fake',
    audio: { getAudioPlaybackFile: async () => ({ kind: 'local', absolutePath: sourcePath }) },
  });
  let args;
  store.preprocessor.runner = async (_executable, input) => {
    args = input;
    await writeFile(input.at(-1), 'independent mp3');
  };
  try {
    await mkdir(audioDirectory, { recursive: true });
    await writeFile(sourcePath, 'synthetic');
    const source = await store.source(randomUUID(), randomUUID());
    const task = randomUUID();
    const turn = { segmentId: randomUUID(), startMs: 1100, endMs: 2700 };
    const key = await store.archive(task, turn, 0, source);
    assert.equal(args[args.indexOf('-ss') + 1], '1.100');
    assert.equal(args[args.indexOf('-t') + 1], '1.600');
    await unlink(sourcePath);
    assert.equal((await store.playback(key)).sizeBytes, 15);
    assert.equal(await store.findArchived(task, turn.segmentId), key);
    assert.equal(await store.archive(task, turn, 0, source), key);
    await assert.rejects(store.playback('../source.wav'), /不存在/);
    await store.remove(key);
    assert.equal(await store.findArchived(task, turn.segmentId), undefined);
  } finally {
    assert.equal(path.dirname(root), tmpdir());
    await rm(root, { recursive: true, force: true });
  }
});
test('missing source and unavailable FFmpeg fail media while preserving collected text', async () => {
  const id = randomUUID();
  const turn = { segmentId: randomUUID(), startMs: 0, endMs: 1000 };
  let mediaStatus;
  const current = {
    content: { turns: [turn] },
    source: { audioFileId: id },
    media: [{ segmentId: turn.segmentId, status: 'pending' }],
  };
  const repository = {
    projectionVersion: async () => ({}),
    getCase: async () => current,
    saveMedia: async (_id, _v, _s, status) => {
      mediaStatus = status;
      return true;
    },
  };
  const media = {
    findArchived: async () => undefined,
    source: async () => {
      throw new Error('missing');
    },
  };
  const service = new CollectionService(repository, {}, {}, {}, media);
  await assert.rejects(service.mediaTask({ id, payload: { caseId: id, version: 1 } }), /源音频/);
  assert.equal(mediaStatus, 'missing');
  assert.deepEqual(current.content.turns, [turn]);
  media.source = async () => ({ storageKey: 'source', cleanup: async () => undefined });
  media.archive = async () => {
    throw new Error('FFmpeg');
  };
  await assert.rejects(
    service.mediaTask({ id, payload: { caseId: id, version: 1 } }),
    /片段生成失败/,
  );
  assert.equal(mediaStatus, 'failed');
});
