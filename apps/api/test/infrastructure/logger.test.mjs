/**
 * 日志核心回归测试（独立进程执行）。
 *
 * 使用内存 destination 验证上下文合并、敏感字段脱敏、Error 堆栈保留与子 Logger 重建。
 * 本文件会替换进程级根 Logger，因此不能与其他测试文件同进程并发运行：package.json 的
 * test 脚本把它排除出默认 glob，再以单独一个 node --test 进程运行它。
 */
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import path from 'node:path';

/** 只有在 node --test 明确只跑本文件时才启用，避免污染同批次其他文件的标准输出。 */
function isIsolatedRun(fileName) {
  const entry = process.argv[1];
  return typeof entry === 'string' && path.basename(entry) === fileName;
}

const suite = isIsolatedRun('logger.test.mjs') ? describe : describe.skip;

suite('logger core', async () => {
  const { childLogger, configureLogger, getLogger, runWithLogContext, updateLogContext } =
    await import('../../dist/infrastructure/logger.js');

  /** 收集 NDJSON 行的内存 destination；同步流立即收到 write 调用。 */
  const createCapture = () => ({
    lines: [],
    write(chunk) {
      for (const line of String(chunk).split('\n')) {
        if (line.trim()) this.lines.push(JSON.parse(line));
      }
      return true;
    },
  });

  let capture;

  beforeEach(() => {
    capture = createCapture();
    configureLogger({ level: 'debug', format: 'json' }, capture);
  });

  after(() => {
    configureLogger({ level: 'silent', format: 'json' });
  });

  it('attaches the async log context to every log line in the chain', () => {
    const logger = getLogger();
    runWithLogContext({ requestId: 'req-1', tenantId: 'tenant-1' }, () => {
      logger.info({ path: '/api/hello' }, 'outer');
      // 模拟把 HTTP 上下文交给深层业务代码：不需要把 requestId 逐层传参。
      runWithLogContext({ requestId: 'req-1', tenantId: 'tenant-1' }, () => logger.warn('inner'));
      // 领取任务后用 updateLogContext 补充字段，而不是重建整个上下文。
      updateLogContext({ jobId: 'job-1' });
      logger.warn('after-job-claim');
    });
    logger.info('outside');

    const lines = capture.lines;
    assert.equal(lines.length, 4);
    assert.equal(lines[0].requestId, 'req-1');
    assert.equal(lines[0].tenantId, 'tenant-1');
    assert.equal(lines[0].path, '/api/hello');
    assert.equal(lines[1].requestId, 'req-1');
    assert.equal(lines[1].jobId, undefined);
    assert.equal(lines[2].requestId, 'req-1');
    assert.equal(lines[2].jobId, 'job-1');
    assert.equal(lines[3].requestId, undefined);
  });

  it('makes fields added by updateLogContext visible to the rest of the chain', () => {
    const logger = getLogger();
    runWithLogContext({ requestId: 'req-2' }, () => {
      logger.info('before');
      updateLogContext({ tenantId: 'tenant-2', audioFileId: 'audio-2' });
      logger.info('after');
    });

    assert.equal(capture.lines[0].tenantId, undefined);
    assert.equal(capture.lines[1].tenantId, 'tenant-2');
    assert.equal(capture.lines[1].audioFileId, 'audio-2');
  });

  it('ignores updateLogContext outside any context', () => {
    updateLogContext({ tenantId: 'tenant-3' });
    getLogger().info('no-context');

    assert.equal(capture.lines[0].tenantId, undefined);
  });

  it('redacts secrets at the top level and one level deep', () => {
    getLogger().info(
      {
        password: 'p',
        apiKey: 'k',
        nested: { accessToken: 't', accessKeySecret: 's', safe: 'kept' },
        headers: { authorization: 'Bearer x', cookie: 'session=1' },
      },
      'secrets',
    );

    const line = capture.lines[0];
    assert.equal(line.password, '[REDACTED]');
    assert.equal(line.apiKey, '[REDACTED]');
    assert.equal(line.nested.accessToken, '[REDACTED]');
    assert.equal(line.nested.accessKeySecret, '[REDACTED]');
    assert.equal(line.nested.safe, 'kept');
    assert.equal(line.headers.authorization, '[REDACTED]');
    assert.equal(line.headers.cookie, '[REDACTED]');
  });

  it('serializes err with type, message and stack', () => {
    getLogger().error({ err: new Error('boom') }, 'failed');

    const line = capture.lines[0];
    assert.equal(line.err.type, 'Error');
    assert.equal(line.err.message, 'boom');
    assert.match(line.err.stack, /boom/);
    assert.equal(line.msg, 'failed');
  });

  it('rebuilds existing component loggers when the root logger is reconfigured', () => {
    // 模拟模块加载期绑定：此时根 Logger 仍是静默实例。
    const early = childLogger('test-component');
    assert.equal(early.bindings().component, 'test-component');

    // beforeEach 已经重新配置；同一组件名必须写入新 destination。
    childLogger('test-component').info({ jobId: 'job-9' }, 'after reconfigure');
    getLogger().info('root line');

    assert.equal(capture.lines.length, 2);
    assert.equal(capture.lines[0].component, 'test-component');
    assert.equal(capture.lines[0].jobId, 'job-9');
    assert.equal(capture.lines[0].service, 'echowave-api');
    assert.equal(capture.lines[1].component, undefined);
  });

  it('keeps the logger silent while the level is silent', () => {
    configureLogger({ level: 'silent', format: 'json' }, capture);
    getLogger().fatal('must not appear');

    assert.equal(capture.lines.length, 0);
  });
});
