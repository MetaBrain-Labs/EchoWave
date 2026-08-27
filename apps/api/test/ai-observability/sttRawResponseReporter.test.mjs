/**
 * STT 原始响应报告器测试。
 *
 * 验证独立开关、唯一文件、响应保护和写入失败旁路。
 */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  MAX_STT_RAW_RESPONSE_BYTES,
  createSttRawResponseReporter,
} from '../../dist/ai-observability/sttRawResponseReporter.js';

const reportInput = {
  revisionId: '11111111-1111-4111-8111-111111111111',
  model: 'qwen-audio-3.0-asr-flash-filetrans',
  preprocessing: 'whole_file',
  format: 'mp3',
  chunkIndex: 1,
  chunkCount: 2,
  durationMs: 45_000,
  networkAttempt: 1,
  httpStatus: 200,
  contentType: 'application/json',
  generationId: 'generation-1',
  outcome: 'completed',
  rawResponseText: '{"text":"测试"}',
};

describe('STT raw response reporter', () => {
  it('does no work while disabled', async () => {
    const writes = [];
    const reporter = createSttRawResponseReporter(
      { enabled: false, outputDirectory: '.ai-execution-reports' },
      {
        now: () => {
          throw new Error('disabled reporter must not read the clock');
        },
        writeReport: async (...args) => writes.push(args),
      },
    );

    await reporter.record(reportInput);
    assert.deepEqual(writes, []);
  });

  it('writes one uniquely named JSON envelope per response', async () => {
    const writes = [];
    const ids = ['first', 'second'];
    const reporter = createSttRawResponseReporter(
      { enabled: true, outputDirectory: '.ai-execution-reports' },
      {
        repositoryRoot: 'C:\\repo',
        now: () => new Date('2026-08-25T01:02:03.000Z'),
        createId: () => ids.shift(),
        writeReport: async (filePath, content) => writes.push({ filePath, content }),
      },
    );

    await Promise.all([
      reporter.record(reportInput),
      reporter.record({ ...reportInput, networkAttempt: 2, outcome: 'http_error' }),
    ]);

    assert.equal(writes.length, 2);
    assert.equal(new Set(writes.map(({ filePath }) => filePath)).size, 2);
    assert.ok(
      writes.every(({ filePath }) => filePath.includes(path.join('stt-raw', '2026-08-25'))),
    );
    const report = JSON.parse(writes[0].content);
    assert.equal(report.schemaVersion, 2);
    assert.equal(report.revisionId, reportInput.revisionId);
    assert.deepEqual(report.response.rawResponseBody, { text: '测试' });
    assert.equal(report.response.rawResponseText, undefined);
    assert.equal(report.response.bodyByteLength, Buffer.byteLength(reportInput.rawResponseText));
    assert.equal(report.response.truncated, false);
  });

  it('truncates oversized responses and redacts sensitive response content', async () => {
    const writes = [];
    const sensitivePrefix = JSON.stringify({
      authorization: 'Bearer provider-secret',
      audio: 'A'.repeat(300),
      path: 'E:\\private\\audio.mp3',
    });
    const rawResponseText = `${sensitivePrefix}${'文'.repeat(MAX_STT_RAW_RESPONSE_BYTES)}`;
    const reporter = createSttRawResponseReporter(
      { enabled: true, outputDirectory: '.ai-execution-reports' },
      {
        now: () => new Date('2026-08-25T01:02:03.000Z'),
        createId: () => 'protected',
        writeReport: async (filePath, content) => writes.push({ filePath, content }),
      },
    );

    await reporter.record({ ...reportInput, rawResponseText });

    const report = JSON.parse(writes[0].content);
    assert.equal(report.response.truncated, true);
    assert.ok(report.response.redactionCount >= 3);
    assert.match(report.response.rawResponseText, /\[REDACTED\]/);
    assert.match(report.response.rawResponseText, /\[REDACTED_BASE64\]/);
    assert.match(report.response.rawResponseText, /\[REDACTED_PATH\]/);
    assert.doesNotMatch(report.response.rawResponseText, /provider-secret/);
    assert.equal(report.response.rawResponseBody, undefined);
    assert.equal(
      report.response.bodySha256,
      createHash('sha256').update(Buffer.from(rawResponseText)).digest('hex'),
    );
  });

  it('records DashScope response kinds while redacting signed OSS query credentials', async () => {
    const writes = [];
    const reporter = createSttRawResponseReporter(
      { enabled: true, outputDirectory: '.ai-execution-reports' },
      {
        now: () => new Date('2026-08-26T01:02:03.000Z'),
        createId: () => 'dashscope',
        writeReport: async (filePath, content) => writes.push({ filePath, content }),
      },
    );
    await reporter.record({
      ...reportInput,
      model: 'qwen-audio-3.0-asr-flash-filetrans',
      provider: 'dashscope',
      preprocessing: 'whole_file',
      responseKind: 'transcription_result',
      rawResponseText:
        '{"transcription_url":"https://oss.example/result.json?OSSAccessKeyId=id&Signature=secret"}',
    });

    const report = JSON.parse(writes[0].content);
    assert.equal(report.provider, 'dashscope');
    assert.equal(report.responseKind, 'transcription_result');
    assert.equal(report.response.rawResponseText, undefined);
    assert.match(report.response.rawResponseBody.transcription_url, /OSSAccessKeyId=\[REDACTED\]/);
    assert.match(report.response.rawResponseBody.transcription_url, /Signature=\[REDACTED\]/);
    assert.doesNotMatch(report.response.rawResponseBody.transcription_url, /Signature=secret/);
  });

  it('keeps the raw text when the body is not valid JSON', async () => {
    const writes = [];
    const reporter = createSttRawResponseReporter(
      { enabled: true, outputDirectory: '.ai-execution-reports' },
      {
        now: () => new Date('2026-08-26T02:03:04.000Z'),
        createId: () => 'html-error',
        writeReport: async (filePath, content) => writes.push({ filePath, content }),
      },
    );
    await reporter.record({
      ...reportInput,
      outcome: 'http_error',
      rawResponseText: '<html>Gateway Timeout</html>',
    });

    const report = JSON.parse(writes[0].content);
    assert.equal(report.response.rawResponseText, '<html>Gateway Timeout</html>');
    assert.equal(report.response.rawResponseBody, undefined);
  });

  it('isolates writer failures', async () => {
    const warnings = [];
    const reporter = createSttRawResponseReporter(
      { enabled: true, outputDirectory: '.ai-execution-reports' },
      {
        writeReport: async () => {
          throw new Error('disk unavailable');
        },
        warn: (message) => warnings.push(message),
      },
    );

    await reporter.record(reportInput);
    assert.deepEqual(warnings, ['[stt-raw-response-report] failed to write response report']);
  });
});
