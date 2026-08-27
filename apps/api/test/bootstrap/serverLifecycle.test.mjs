/**
 * API 服务生命周期测试。
 *
 * 验证 Worker 启动顺序、监听失败、幂等关闭与超时强制退出，避免 Windows 开发流程留下孤立 Worker。
 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';

import {
  createGracefulShutdown,
  startWorkersAfterListening,
} from '../../dist/bootstrap/serverLifecycle.js';

class FakeServer extends EventEmitter {
  listening = false;
  closeCalls = 0;
  closeAllConnectionsCalls = 0;
  closeCallbacks = [];

  close(callback) {
    this.closeCalls += 1;
    this.listening = false;
    this.closeCallbacks.push(callback);
    queueMicrotask(() => this.finishClose());
    return this;
  }

  closeAllConnections() {
    this.closeAllConnectionsCalls += 1;
    this.finishClose();
  }

  finishClose(error) {
    for (const callback of this.closeCallbacks.splice(0)) callback(error);
  }
}

describe('API server lifecycle', () => {
  it('starts workers only after HTTP listening succeeds', async () => {
    const server = new FakeServer();
    let workersStarted = false;
    const started = startWorkersAfterListening(server, async () => {
      workersStarted = true;
    });

    assert.equal(workersStarted, false);
    server.listening = true;
    server.emit('listening');
    await started;
    assert.equal(workersStarted, true);
  });

  it('does not start workers when HTTP listening fails', async () => {
    const server = new FakeServer();
    let workersStarted = false;
    const started = startWorkersAfterListening(server, async () => {
      workersStarted = true;
    });

    server.emit('error', Object.assign(new Error('occupied'), { code: 'EADDRINUSE' }));
    await assert.rejects(started, /occupied/);
    assert.equal(workersStarted, false);
  });

  it('closes the HTTP server and runtime exactly once', async () => {
    const server = new FakeServer();
    server.listening = true;
    let runtimeCloseCalls = 0;
    const shutdown = createGracefulShutdown({
      server,
      closeRuntime: async () => {
        runtimeCloseCalls += 1;
      },
    });

    await Promise.all([shutdown(), shutdown()]);
    assert.equal(server.closeCalls, 1);
    assert.equal(runtimeCloseCalls, 1);
  });

  it('forces termination when active connections prevent graceful shutdown', async () => {
    const server = new FakeServer();
    server.listening = true;
    server.close = function close(callback) {
      this.closeCalls += 1;
      this.listening = false;
      this.closeCallbacks.push(callback);
      return this;
    };
    let forcedExitCode = null;
    const shutdown = createGracefulShutdown({
      server,
      closeRuntime: async () => undefined,
      timeoutMs: 5,
      forceExit: (code) => {
        forcedExitCode = code;
      },
    });

    await shutdown();
    assert.equal(server.closeAllConnectionsCalls, 1);
    assert.equal(forcedExitCode, 1);
  });
});
