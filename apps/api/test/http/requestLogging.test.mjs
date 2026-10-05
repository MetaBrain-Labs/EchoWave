/**
 * HTTP 请求日志与 requestId 中间件测试（独立进程执行）。
 *
 * 验证 X-Request-Id 响应头、访问日志字段、错误传播与 CORS 暴露头。
 * 本文件会替换进程级根 Logger，因此由 package.json 的 test 脚本从默认 glob 排除后单独运行。
 */
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import path from 'node:path';

/** 只有在 node --test 明确只跑本文件时才启用，避免污染同批次其他文件的标准输出。 */
function isIsolatedRun(fileName) {
  const entry = process.argv[1];
  return typeof entry === 'string' && path.basename(entry) === fileName;
}

const suite = isIsolatedRun('requestLogging.test.mjs') ? describe : describe.skip;

suite('request logging middleware', async () => {
  const { Hono } = await import('hono');
  const { createApp } = await import('../../dist/http/app.js');
  const { installErrorHandlers } = await import('../../dist/http/errorHandler.js');
  const { requestLogging } = await import('../../dist/http/requestLogging.js');
  const { configureLogger } = await import('../../dist/infrastructure/logger.js');

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

  const createProbeApp = () => {
    const app = new Hono();
    app.use('*', requestLogging({ tenantId: 'tenant-probe' }));
    installErrorHandlers(app);
    app.get('/ok', (context) => context.json({ ok: true }));
    app.get('/health', (context) => context.json({ status: 'ok' }));
    app.get('/boom', () => {
      throw new Error('probe failure');
    });
    return app;
  };

  it('returns a unique X-Request-Id and one access log line per request', async () => {
    const app = createProbeApp();
    const first = await app.request('/ok');
    const second = await app.request('/ok');

    const firstId = first.headers.get('X-Request-Id');
    const secondId = second.headers.get('X-Request-Id');
    assert.ok(firstId);
    assert.ok(secondId);
    assert.notEqual(firstId, secondId);

    const line = capture.lines[0];
    assert.equal(line.method, 'GET');
    assert.equal(line.path, '/ok');
    assert.equal(line.statusCode, 200);
    assert.equal(typeof line.durationMs, 'number');
    assert.equal(line.component, 'http');
    // 应用级上下文（固定租户）自动附加到访问日志。
    assert.equal(line.tenantId, 'tenant-probe');
    assert.equal(line.requestId, firstId);
  });

  it('keeps /health at debug level', async () => {
    const app = createProbeApp();
    await app.request('/health');

    assert.equal(capture.lines.length, 1);
    assert.equal(capture.lines[0].level, 20);
    assert.equal(capture.lines[0].path, '/health');
  });

  it('logs a thrown route error at error level without swallowing it', async () => {
    const app = createProbeApp();
    const response = await app.request('/boom');

    assert.equal(response.status, 500);
    const levels = capture.lines.map((line) => line.level);
    assert.ok(levels.includes(50), 'expected an error-level line');
    const failure = capture.lines.find((line) => line.msg === 'API request failed');
    assert.equal(failure.errorCode, 'INTERNAL_ERROR');
    assert.match(failure.err.stack, /probe failure/);
    const access = capture.lines.find((line) => line.msg === 'HTTP request completed');
    assert.equal(access.statusCode, 500);
    assert.ok(response.headers.get('X-Request-Id'));
  });

  it('exposes X-Request-Id through CORS', async () => {
    const app = createApp({ corsOrigins: ['http://localhost:8081'] });
    const response = await app.request('/api/hello', {
      headers: { Origin: 'http://localhost:8081' },
    });

    assert.match(response.headers.get('Access-Control-Expose-Headers'), /X-Request-Id/);
    assert.ok(response.headers.get('X-Request-Id'));
  });
});
