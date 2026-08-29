/**
 * 音频执行轨迹 SSE 解析测试。
 *
 * 验证移动端在 UTF-8 字符、CRLF 帧边界和多个网络分块交错时仍能稳定恢复事件。
 *
 * Responsibilities:
 * - 锁定增量解码与完整帧输出顺序。
 * - 拒绝不符合共享契约的实时事件。
 *
 * Notes:
 * - 测试不建立真实网络连接，只覆盖流协议的纯解析边界。
 */
import { AudioExecutionSseParser } from '../audioExecutionStream';

const audioFileId = '11111111-1111-4111-8111-111111111111';
const revisionId = '22222222-2222-4222-8222-222222222222';
const runId = '33333333-3333-4333-8333-333333333333';
const operationId = '44444444-4444-4444-8444-444444444444';

describe('AudioExecutionSseParser', () => {
  it('parses Chinese reasoning across UTF-8 and CRLF chunk boundaries', () => {
    const parser = new AudioExecutionSseParser();
    const event = {
      type: 'reasoning-delta',
      cursor: '18',
      audioFileId,
      analysisRevisionId: revisionId,
      runId,
      operationId,
      delta: '先核对客户需求，再检查知识证据。',
      truncated: false,
    };
    const bytes = new TextEncoder().encode(
      `id: 18\r\nevent: reasoning-delta\r\ndata: ${JSON.stringify(event)}\r\n\r\n`,
    );
    const decoded = [
      ...parser.push(bytes.slice(0, 17)),
      ...parser.push(bytes.slice(17, 46)),
      ...parser.push(bytes.slice(46, 63)),
      ...parser.push(bytes.slice(63)),
      ...parser.finish(),
    ];

    expect(decoded).toEqual([event]);
  });

  it('rejects malformed events when the final frame is flushed', () => {
    const parser = new AudioExecutionSseParser();
    parser.push(new TextEncoder().encode('data: {"type":"reasoning-delta"}'));

    expect(() => parser.finish()).toThrow('无效事件');
  });
});
