/**
 * 实时状态事件总线。
 *
 * 在当前单 API 实例内传递资源失效信号，供 SSE 连接在权威数据库状态变化后立即刷新。
 *
 * Responsibilities:
 * - 按当前运行时租户的资源范围发布音频、分析、文档和执行审计变更。
 * - 为每个订阅者合并尚未消费的重复信号，避免慢连接产生无界队列。
 *
 * Notes:
 * - 事件不是业务事实或恢复日志；客户端重连时必须重新读取数据库快照。
 */

export type LiveUpdateEvent =
  | {
      kind: 'data-source-audio';
      dataSourceId: string;
      audioFileId: string;
      terminal: boolean;
    }
  | {
      kind: 'audio-analysis';
      audioFileId: string;
      groupId: string | null;
      terminal: boolean;
    }
  | {
      kind: 'knowledge-document';
      knowledgeBaseId: string;
      documentId: string;
      terminal: boolean;
    }
  | {
      kind: 'audio-execution';
      audioFileId: string;
      analysisRevisionId: string;
    };

type EventFilter = (event: LiveUpdateEvent) => boolean;

function eventKey(event: LiveUpdateEvent): string {
  switch (event.kind) {
    case 'data-source-audio':
      return `${event.kind}:${event.dataSourceId}:${event.audioFileId}`;
    case 'audio-analysis':
      return `${event.kind}:${event.audioFileId}:${event.groupId ?? ''}`;
    case 'knowledge-document':
      return `${event.kind}:${event.knowledgeBaseId}:${event.documentId}`;
    case 'audio-execution':
      return `${event.kind}:${event.audioFileId}:${event.analysisRevisionId}`;
  }
}

/** 单个 SSE 连接持有的有界订阅。 */
export class LiveUpdateSubscription {
  private readonly pending = new Map<string, LiveUpdateEvent>();
  private resolver?: (event: LiveUpdateEvent | undefined) => void;
  private closed = false;

  constructor(private readonly unsubscribe: () => void) {}

  /** 合并未消费事件；相同资源的最新状态会覆盖旧信号。 */
  push(event: LiveUpdateEvent): void {
    if (this.closed) return;
    if (this.resolver) {
      const resolve = this.resolver;
      this.resolver = undefined;
      resolve(event);
      return;
    }
    this.pending.set(eventKey(event), event);
  }

  /** 等待下一个资源信号；超时返回 undefined，供调用方发送心跳。 */
  wait(timeoutMs: number): Promise<LiveUpdateEvent | undefined> {
    if (this.closed) return Promise.resolve(undefined);
    const next = this.pending.entries().next();
    if (!next.done) {
      const [key, event] = next.value;
      this.pending.delete(key);
      return Promise.resolve(event);
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.resolver !== complete) return;
        this.resolver = undefined;
        resolve(undefined);
      }, timeoutMs);
      timer.unref?.();
      const complete = (event: LiveUpdateEvent | undefined) => {
        clearTimeout(timer);
        resolve(event);
      };
      this.resolver = complete;
    });
  }

  /** 释放订阅并唤醒仍在等待的 SSE 循环。 */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe();
    this.pending.clear();
    const resolve = this.resolver;
    this.resolver = undefined;
    resolve?.(undefined);
  }
}

/** 当前单实例运行时共享的轻量发布订阅器。 */
export class LiveUpdateBroker {
  private readonly subscribers = new Map<LiveUpdateSubscription, EventFilter>();

  subscribe(filter: EventFilter): LiveUpdateSubscription {
    let subscription: LiveUpdateSubscription;
    subscription = new LiveUpdateSubscription(() => this.subscribers.delete(subscription));
    this.subscribers.set(subscription, filter);
    return subscription;
  }

  /** 发布失败不得反向影响已完成的业务持久化。 */
  publish(event: LiveUpdateEvent): void {
    for (const [subscription, filter] of this.subscribers) {
      try {
        if (filter(event)) subscription.push(event);
      } catch {
        // 订阅过滤器属于传输协调逻辑，不能影响生产者。
      }
    }
  }
}
