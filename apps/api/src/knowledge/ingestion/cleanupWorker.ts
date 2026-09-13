/**
 * 知识版本后台清理执行器。
 *
 * 恢复 chunks 和文件清理阶段，数据库任务事实负责重试与幂等。
 *
 * Responsibilities:
 * - 消费提交后通知并保留低频安全扫描。
 * - 清理受控文件和无数据库引用的孤立上传。
 *
 * Notes:
 * - 不修改文档删除状态，不删除历史分析。
 */
import { readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { WorkerWakeupSource } from '../../infrastructure/workerWakeup.ts';
import { KnowledgeCleanupRepository } from '../persistence/cleanupRepository.ts';
import { checkedKnowledgeFilePath, knowledgeStoragePath } from './storage.ts';

/** 管理可恢复版本清理与服务关闭的 worker。 */
export class KnowledgeCleanupWorker {
  private timer?: NodeJS.Timeout;
  private unsubscribe?: () => void;
  private running?: Promise<void>;
  private stopping = true;
  private lastOrphanScan = 0;
  constructor(
    private readonly repository: KnowledgeCleanupRepository,
    private readonly storageDirectory: string,
    private readonly tempDirectory: string,
    private readonly wakeup?: WorkerWakeupSource,
  ) {}
  /** 启动通知和安全扫描。 */
  start(): void {
    if (this.timer) return;
    this.stopping = false;
    this.unsubscribe = this.wakeup?.subscribe('knowledge-cleanup', () => this.pump());
    this.timer = setInterval(() => this.pump(), 15_000);
    this.timer.unref();
    this.pump();
  }
  /** 停止领取并等待已开始清理收敛。 */
  async stop(): Promise<void> {
    this.stopping = true;
    this.unsubscribe?.();
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.running;
  }
  /** 合并通知与扫描唤醒，避免单实例同时执行多轮清理。 */
  private pump(): void {
    if (this.running || this.stopping) return;
    this.running = this.drain()
      .catch(() => console.warn('Knowledge cleanup scan failed'))
      .finally(() => {
        this.running = undefined;
      });
  }
  /** 恢复清理阶段并按数据库引用扫描孤立文件，失败版本保持不可检索。 */
  private async drain(): Promise<void> {
    while (!this.stopping) {
      const job = await this.repository.claim();
      if (!job) break;
      try {
        await this.repository.removeChunks(job);
        const files = new Set<string>();
        if (job.storage_key)
          files.add(knowledgeStoragePath(this.storageDirectory, job.storage_key));
        if (job.staged_path)
          files.add(
            checkedKnowledgeFilePath(job.staged_path, [this.storageDirectory, this.tempDirectory]),
          );
        for (const file of files)
          await unlink(file).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== 'ENOENT') throw error;
          });
        await this.repository.complete(job);
      } catch (error) {
        const code =
          error instanceof Error &&
          ['REVISION_IN_USE', 'LEASE_LOST', 'INVALID_STORAGE_KEY', 'INVALID_STORAGE_PATH'].includes(
            error.message,
          )
            ? error.message
            : 'FILE_CLEANUP_FAILED';
        await this.repository.fail(job, code);
      }
    }
    if (Date.now() - this.lastOrphanScan < 60 * 60 * 1000) return;
    this.lastOrphanScan = Date.now();
    for (const directory of new Set([this.storageDirectory, this.tempDirectory])) {
      const root = path.resolve(directory);
      const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (!entry.isFile() || !/^[0-9a-f-]{36}\.upload$/.test(entry.name)) continue;
        const file = path.join(root, entry.name);
        const details = await stat(file);
        if (
          details.mtimeMs < Date.now() - 24 * 60 * 60 * 1000 &&
          !(await this.repository.isReferenced(entry.name, file))
        )
          await unlink(file).catch(() => undefined);
      }
    }
  }
}
