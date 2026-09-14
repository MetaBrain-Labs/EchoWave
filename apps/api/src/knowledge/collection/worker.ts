/**
 * 案例收集后台 Worker。
 *
 * 通过权威 PostgreSQL 队列和独立租约运行可恢复工作流。
 *
 * Responsibilities:
 * - 响应提交后通知，并保留安全扫描。
 * - 定期续租和记录紧凑失败原因。
 *
 * Notes:
 * - 失败不会回滚已成功的音频分析。
 */
import type { WorkerWakeupSource } from '../../infrastructure/workerWakeup.ts';
import type { CollectionService } from './service.ts';
import { createCollectionGraph } from './graph/graph.ts';

/** 单 Worker 顺序处理任务，跨实例由数据库隔离领取。 */
export class CollectionWorker {
  private timer?: NodeJS.Timeout;
  private unsubscribe?: () => void;
  private stopping = false;
  private active?: Promise<void>;
  private readonly graph;
  constructor(
    private readonly service: CollectionService,
    private readonly wakeup?: WorkerWakeupSource,
  ) {
    this.graph = createCollectionGraph(service);
  }
  /** 开始通知订阅及补偿扫描。 */
  start(): void {
    if (this.timer) return;
    this.stopping = false;
    this.unsubscribe = this.wakeup?.subscribe('analysis-case-collection', () => this.wake());
    this.timer = setInterval(() => this.wake(), 5000);
    this.timer.unref();
    this.wake();
  }
  private wake(): void {
    if (this.stopping || this.active) return;
    this.active = this.drain()
      .catch(() => {
        console.warn('[case-collection] Queue temporarily unavailable.');
      })
      .finally(() => {
        this.active = undefined;
      });
  }
  private async drain(): Promise<void> {
    while (!this.stopping) {
      const task = await this.service.repository.claim();
      if (!task) return;
      const heartbeat = setInterval(() => {
        void this.service.repository.taskState(task, 'running', task.kind).catch(() => undefined);
      }, 20_000);
      try {
        await this.graph.invoke({ task });
      } catch {
        const message =
          task.kind === 'media'
            ? '音频未能全部归档，请恢复源文件或检查 FFmpeg 后重试。'
            : task.kind === 'projection'
              ? '案例检索入库失败，请检查知识向量配置后重试。'
              : task.kind === 'cleanup'
                ? '案例媒体清理失败。'
                : '案例收集失败，请检查来源记录和目标库。';
        await this.service.repository
          .taskState(task, 'failed', task.kind, message)
          .catch(() => undefined);
      } finally {
        clearInterval(heartbeat);
      }
    }
  }
  /** 停止订阅后等待当前任务收敛，保留未领取任务。 */
  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.unsubscribe?.();
    await this.active;
  }
}
