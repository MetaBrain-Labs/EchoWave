/**
 * 案例收集应用服务。
 *
 * 协调规则、人工审核、历史补收、检索投影和音频归档。
 *
 * Responsibilities:
 * - 从既有分析收集内容，不增加新的模型提取任务。
 * - 分开恢复文本入库和音频失败。
 *
 * Notes:
 * - HTTP 和后台工作流通过同一窄仓储执行。
 */
import {
  FrozenCollectionRuleSchema,
  CollectionRuleInputSchema,
  CollectionRuleSchema,
} from '@echowave/contracts';
import { createHash } from 'node:crypto';
import type {
  CaseContent,
  CollectionHistoryRequest,
  ManualCollectionRequest,
} from '@echowave/contracts';
import type { IngestionRepository } from '../persistence/ingestionRepository.ts';
import type { KnowledgeService } from '../service.ts';
import type { SettingsService } from '../../settings/service.ts';
import { parseKnowledgeDocument } from '../ingestion/documentParser.ts';
import { RagRepositoryError } from '../persistence/errors.ts';
import { caseMarkdown, matchesCollectionRule } from './policy.ts';
import { CollectionRepository, type CollectionTask } from './repository.ts';
import { CaseMediaStore } from './media.ts';

/** 案例功能的业务协调器。 */
export class CollectionService {
  constructor(
    readonly repository: CollectionRepository,
    private readonly ingestion: Pick<IngestionRepository, 'createIngestion'>,
    private readonly knowledge: Pick<KnowledgeService, 'retryDocument'>,
    private readonly settings: Pick<SettingsService, 'resolveCapability'>,
    private readonly media: CaseMediaStore,
  ) {}
  /** 手动收集使用和自动规则相同的去重与来源约束。 */
  async manual(input: ManualCollectionRequest) {
    const sources = await this.repository.sources(input.jobId, input.correctionId, true);
    let source = input.correctionId
      ? sources[0]
      : (sources.find((s) => s.tagId === input.tagId) ?? sources[0]);
    if (!source || (input.tagId && source.tagId !== input.tagId))
      throw new RagRepositoryError('NOT_FOUND', '所选分析证据不存在。');
    if (input.segmentIds && !input.tagId && !input.correctionId)
      source = {
        ...source,
        tagId: null,
        segmentIds: input.segmentIds,
        title: input.content?.title ?? '对话案例',
        reason: input.content?.reason ?? '用户手动收集的真实对话。',
      };
    return this.repository.collect(
      source,
      {
        name: 'Manual',
        enabled: true,
        mode: 'review',
        category: input.category,
        knowledgeBaseId: input.knowledgeBaseId,
        filters: {
          sources: ['strength'],
          customLabels: [],
          dataSourceIds: [],
          minimumConfidence: null,
          keywords: [],
        },
      },
      'manual',
      input.content,
    );
  }
  /** 补收采用当前规则预览，但不改动已有候选与拒绝状态。 */
  async history(groupId: string, range: CollectionHistoryRequest, start: boolean) {
    const rule = (await this.repository.listRules(groupId)).items.find(
      (r) => r.id === range.ruleId,
    );
    if (!rule) throw new RagRepositoryError('NOT_FOUND', '收集规则不存在。');
    const sources = (await this.repository.historySources(groupId, range)).filter((s) =>
      matchesCollectionRule(rule, s),
    );
    if (!start) return { count: sources.length };
    return this.repository.startHistory(groupId, rule, sources);
  }
  /** 从固定版本生成可编辑案例内容供手动收集界面选择。 */
  async capture(jobId: string) {
    const sources = await this.repository.sources(jobId, null, true);
    const source = sources[0];
    if (!source) throw new RagRepositoryError('NOT_FOUND', '当前分析没有可收集的标签。');
    return {
      jobId,
      groupId: source.groupId,
      availableTurns: source.availableTurns,
      tags: sources
        .filter((s) => s.tagId)
        .map((s) => ({
          id: s.tagId!,
          category: s.category,
          customLabel: s.customLabel,
          title: s.title,
          reason: s.reason,
          segmentIds: s.segmentIds,
        })),
    };
  }
  /** 文本更新始终交给版本仓储；模型结果不会被人工编辑反向改写。 */
  updateCase(id: string, version: number, content: CaseContent) {
    return this.repository.updateCase(id, version, content);
  }
  /** 失败重试不改变正式/候选的审核状态。 */
  async action(
    id: string,
    version: number,
    action: 'publish' | 'reject' | 'withdraw' | 'delete' | 'retry',
  ) {
    if (action === 'retry') {
      const current = await this.repository.getCase(id);
      if(current.version!==version||current.status!=='published')throw new RagRepositoryError('CONFLICT','案例版本已变化。');
      for (const turn of current.media.filter((m) => m.status === 'ready')) {
        try {
          await this.playback(id, version, turn.segmentId);
        } catch {
          await this.repository.invalidateMedia(id, version, turn.segmentId);
        }
      }
      await this.repository.retryCase(id,version);
      if (current.publication === 'failed' && current.documentId && current.publicationRetryable) {
        await this.knowledge.retryDocument(current.knowledgeBaseId, current.documentId, {
          id,
          version,
        });
      }
      return this.repository.getCase(id);
    }
    return this.repository.action(id, version, action);
  }
  /** 保存来源时冻结的规则；历史任务可限制到一个标签。 */
  async collectTask(task: CollectionTask): Promise<void> {
    const sources = await this.repository.sources(task.payload.jobId!, task.payload.correctionId);
    for (const frozen of task.payload.rules ?? []) {
      const legacy = CollectionRuleSchema.safeParse(frozen);
      const identity = FrozenCollectionRuleSchema.safeParse(
        legacy.success
          ? {
              id: legacy.data.id,
              version: legacy.data.version,
              input: Object.fromEntries(
                Object.entries(legacy.data).filter(
                  ([key]) => !['id', 'version', 'groupId', 'updatedAt'].includes(key),
                ),
              ),
            }
          : frozen,
      );
      const rule = identity.success
        ? identity.data.input
        : CollectionRuleInputSchema.parse(
            Object.fromEntries(
              Object.entries(frozen).filter(
                ([key]) => !['id', 'version', 'groupId', 'updatedAt'].includes(key),
              ),
            ),
          );
      for (const source of sources) {
        if (task.payload.tagId && source.tagId !== task.payload.tagId) continue;
        if (matchesCollectionRule(rule, source))
          await this.repository.collect(
            source,
            rule,
            'automatic',
            undefined,
            identity.success ? identity.data : undefined,
          );
      }
    }
  }
  /** 投影与版本链接在同一入库事务建立，崩溃恢复不会多建文档。 */
  async projectTask(task: CollectionTask): Promise<void> {
    const id = task.payload.caseId!;
    const version = task.payload.version!;
    const linked = await this.repository.projectionVersion(id, version);
    if (!linked || linked.document_revision_id) return;
    const current = await this.repository.getCase(id);
    const buffer = Buffer.from(caseMarkdown(id, current.content));
    const snapshot = await parseKnowledgeDocument(buffer, 'markdown', current.content.title);
    const embedding = await this.settings.resolveCapability('knowledge_embedding');
    await this.ingestion.createIngestion({
      caseVersionId: linked.id,
      knowledgeBaseId: current.knowledgeBaseId,
      title: current.content.title,
      format: 'markdown',
      sizeBytes: buffer.byteLength,
      sourceSha256: createHash('sha256').update(buffer).digest('hex'),
      stagedPath: '',
      rebuildSnapshot: snapshot,
      parserVersion: 'case-markdown-v1',
      embeddingModel: embedding.model,
      embeddingBindingRevisionId: embedding.revisionId,
    });
  }
  /** 每轮音频独立保存；缺失来源只影响媒体，不删除文字案例。 */
  async mediaTask(task: CollectionTask): Promise<void> {
    const id = task.payload.caseId!;
    const version = task.payload.version!;
    if (!(await this.repository.projectionVersion(id, version))) return;
    let current = await this.repository.getCase(id);
    for (const turn of current.content.turns) {
      if (current.media.find((m) => m.segmentId === turn.segmentId)?.status === 'ready') continue;
      const key = await this.media.findArchived(task.id, turn.segmentId);
      if (key) await this.saveArchive(id, version, turn.segmentId, key);
    }
    current = await this.repository.getCase(id);
    if (current.media.every((m) => m.status === 'ready')) return;
    let source;
    try {
      source = await this.media.source(current.source.audioFileId, task.id);
    } catch {
      for (const turn of current.content.turns)
        if (current.media.find((m) => m.segmentId === turn.segmentId)?.status !== 'ready')
          await this.repository.saveMedia(
            id,
            version,
            turn.segmentId,
            'missing',
            null,
            '源音频不可用，请恢复原文件后重试生成片段。',
          );
      throw new Error('源音频不可用，请恢复原文件后重试。');
    }
    let failed = false;
    try {
      for (const [index, turn] of current.content.turns.entries()) {
        if (current.media.find((m) => m.segmentId === turn.segmentId)?.status === 'ready') continue;
        let key: string | undefined;
        try {
          key = await this.media.archive(task.id, turn, index, source);
          await this.saveArchive(id, version, turn.segmentId, key);
        } catch {
          // 复制完成但数据库暂时失联时保留确定性的片段，下一次领取可恢复。
          failed = true;
          await this.repository.saveMedia(
            id,
            version,
            turn.segmentId,
            'failed',
            null,
            '音频片段生成失败，请检查 FFmpeg 配置后重试。',
          );
        }
      }
    } finally {
      await source.cleanup();
    }
    if (failed) throw new Error('部分音频片段生成失败，可重试。');
  }
  /** 只有已删除或过期版本的归档被回收，重复写回不能移除已就绪的同一片段。 */
  private async saveArchive(id: string, version: number, segmentId: string, key: string) {
    if (await this.repository.saveMedia(id, version, segmentId, 'ready', key, null)) return;
    let owned: string | undefined;
    try {
      owned = await this.repository.mediaKey(id, version, segmentId);
    } catch {
      /* 删除或版本前进后不再允许当前播放。 */
    }
    if (owned !== key) await this.media.remove(key);
  }
  /** 删除案例只回收它拥有的独立音频，不触及来源音频。 */
  async cleanupTask(task: CollectionTask): Promise<void> {
    for (const key of await this.repository.cleanupKeys(task.payload.caseId!))
      await this.media.remove(key);
    await this.repository.mediaCleaned(task.payload.caseId!);
  }
  /** 当前正式版本的受控音频描述。 */
  async playback(id: string, version: number, segmentId: string) {
    return this.media.playback(await this.repository.mediaKey(id, version, segmentId));
  }
}
