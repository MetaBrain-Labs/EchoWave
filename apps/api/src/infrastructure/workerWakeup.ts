/**
 * PostgreSQL Worker 唤醒总线。
 *
 * 使用一条会话固定的 LISTEN 连接接收任务表提交后的轻量通知，并将队列信号分发给当前
 * API 实例内的后台 Worker；数据库任务表仍是唯一权威来源。
 *
 * Responsibilities:
 * - 过滤当前 schema 与租户的任务通知。
 * - 在监听连接中断后退避重连，并在恢复后唤醒全部 Worker 扫描遗漏任务。
 * - 提供不承载任务正文的进程内订阅接口。
 *
 * Notes:
 * - LISTEN/NOTIFY 只优化延迟；Worker 必须保留数据库安全扫描与 SKIP LOCKED 领取。
 */
import type { PoolClient } from 'pg';

import type { DatabasePool } from './postgres.ts';
import { quoteIdentifier } from './postgres.ts';

export const WORKER_WAKEUP_CHANNEL = 'echowave_worker_jobs';

export type WorkerQueue =
  | 'knowledge-ingestion'
  | 'audio-transcription'
  | 'audio-emotion-analysis'
  | 'audio-role-analysis'
  | 'audio-speaker-review'
  | 'audio-business-analysis';

const workerQueues = new Set<WorkerQueue>([
  'knowledge-ingestion',
  'audio-transcription',
  'audio-emotion-analysis',
  'audio-role-analysis',
  'audio-speaker-review',
  'audio-business-analysis',
]);

type ListenerClient = PoolClient;
type NotificationMessage = { channel: string; payload?: string };

/** Worker 只依赖的最小唤醒订阅接口，便于测试和替换跨进程传输。 */
export interface WorkerWakeupSource {
  subscribe(queue: WorkerQueue, listener: () => void): () => void;
}

/** 使用 PostgreSQL LISTEN/NOTIFY 的跨实例 Worker 唤醒器。 */
export class PostgresWorkerWakeup implements WorkerWakeupSource {
  private readonly listeners = new Map<WorkerQueue, Set<() => void>>();
  private readonly clientHandlers = new WeakMap<
    ListenerClient,
    {
      notification: (message: NotificationMessage) => void;
      error: (error: Error) => void;
      end: () => void;
    }
  >();
  private client?: ListenerClient;
  private reconnectTimer?: NodeJS.Timeout;
  private reconnectAttempt = 0;
  private started = false;
  private stopping = false;

  constructor(
    private readonly pool: DatabasePool,
    private readonly schema: string,
    private readonly tenantId: string,
  ) {}

  /** 订阅一个权威任务队列的失效信号，并返回幂等取消函数。 */
  subscribe(queue: WorkerQueue, listener: () => void): () => void {
    const current = this.listeners.get(queue) ?? new Set<() => void>();
    current.add(listener);
    this.listeners.set(queue, current);
    return () => {
      current.delete(listener);
      if (current.size === 0) this.listeners.delete(queue);
    };
  }

  /** 尝试建立监听；初次连接失败时由安全扫描维持功能，并在后台重连。 */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.stopping = false;
    try {
      await this.connect();
    } catch (error) {
      console.warn('[worker-wakeup] PostgreSQL listener unavailable; using safety polling', {
        error: error instanceof Error ? error.name : 'UnknownError',
      });
      this.scheduleReconnect();
    }
  }

  private async connect(): Promise<void> {
    if (this.stopping || this.client) return;
    const client = await this.pool.connect();
    const onNotification = (message: NotificationMessage) => this.onNotification(message);
    const onError = (error: Error) => this.onConnectionError(client, error);
    const onEnd = () => this.onConnectionError(client, new Error('PostgreSQL listener ended'));
    this.clientHandlers.set(client, {
      notification: onNotification,
      error: onError,
      end: onEnd,
    });
    client.on('notification', onNotification);
    client.on('error', onError);
    client.on('end', onEnd);
    try {
      await client.query(`LISTEN ${quoteIdentifier(WORKER_WAKEUP_CHANNEL)}`);
      if (this.stopping) {
        this.detachClient(client);
        client.release();
        return;
      }
      this.client = client;
      this.reconnectAttempt = 0;
      this.wakeAll();
    } catch (error) {
      this.detachClient(client);
      client.release(true);
      throw error;
    }
  }

  private onNotification(message: NotificationMessage): void {
    if (message.channel !== WORKER_WAKEUP_CHANNEL || !message.payload) return;
    try {
      const payload = JSON.parse(message.payload) as Record<string, unknown>;
      const queue = payload.queue;
      if (
        payload.schema !== this.schema ||
        payload.tenantId !== this.tenantId ||
        typeof queue !== 'string' ||
        !workerQueues.has(queue as WorkerQueue)
      ) {
        return;
      }
      this.wake(queue as WorkerQueue);
    } catch {
      // 通知是非权威唤醒信号；无效 payload 留给安全扫描恢复，不污染业务日志。
    }
  }

  private onConnectionError(client: ListenerClient, error: Error): void {
    if (client !== this.client) return;
    this.client = undefined;
    this.detachClient(client);
    client.release(true);
    if (this.stopping) return;
    console.warn('[worker-wakeup] PostgreSQL listener disconnected; scheduling reconnect', {
      error: error.name,
    });
    this.scheduleReconnect();
  }

  private detachClient(client: ListenerClient): void {
    const handlers = this.clientHandlers.get(client);
    if (!handlers) return;
    client.removeListener('notification', handlers.notification);
    client.removeListener('error', handlers.error);
    client.removeListener('end', handlers.end);
    this.clientHandlers.delete(client);
  }

  private scheduleReconnect(): void {
    if (this.stopping || this.reconnectTimer) return;
    const delays = [1_000, 2_000, 5_000, 10_000] as const;
    const delay = delays[Math.min(this.reconnectAttempt, delays.length - 1)];
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect().catch((error) => {
        console.warn('[worker-wakeup] PostgreSQL listener reconnect failed', {
          error: error instanceof Error ? error.name : 'UnknownError',
        });
        this.scheduleReconnect();
      });
    }, delay);
    this.reconnectTimer.unref();
  }

  private wake(queue: WorkerQueue): void {
    for (const listener of this.listeners.get(queue) ?? []) {
      try {
        listener();
      } catch {
        // 单个 Worker 的调度异常不能阻断其他订阅者，数据库安全扫描仍会兜底。
      }
    }
  }

  private wakeAll(): void {
    for (const queue of this.listeners.keys()) this.wake(queue);
  }

  /** 停止重连并释放会话固定的监听连接。 */
  async close(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    this.stopping = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    const client = this.client;
    this.client = undefined;
    if (client) {
      try {
        await client.query(`UNLISTEN ${quoteIdentifier(WORKER_WAKEUP_CHANNEL)}`);
      } catch {
        // 连接已经失效时无需阻止运行时继续关闭。
      } finally {
        this.detachClient(client);
        client.release();
      }
    }
    this.listeners.clear();
  }
}
