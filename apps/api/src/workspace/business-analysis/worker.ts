/**
 * 分组销售复盘后台 Worker。
 *
 * 领取版本化任务，主动检索当前分组知识库，再调用带白名单搜索工具的 DeepSeek Agent；
 * 发布前严格验证模型引用的片段与知识块确实属于本次输入。
 *
 * Responsibilities:
 * - 编排主动检索、Agent 补充检索、进度、校验和原子发布。
 * - 将供应商失败映射为安全、可重试的任务错误。
 *
 * Notes:
 * - Worker 不修改 ASR、确认转写或后置识别结果。
 */
import type { DashScopeEmbeddings } from '../../knowledge/embeddings/dashScopeEmbeddings.ts';
import type {
  KnowledgeRepository,
  RetrievalChunk,
} from '../../knowledge/persistence/knowledgeRepository.ts';
import type {
  BusinessAnalysisRepository,
  ClaimedBusinessAnalysisJob,
} from '../persistence/businessAnalysisRepository.ts';
import { BusinessAnalysisProviderError, type SalesAnalysisAgent } from './salesAnalysisAgent.ts';

const coreSummaryLabels = {
  overall: '总体总结',
  strengths: '话术优点',
  improvements: '待改进点',
  risks: '风险提示',
  actions: '行动建议',
} as const;

/** 将模型侧固定英文代码转换为产品侧中文章节标题。 */
function localizeCoreSummaryTitle(title: string): string {
  if (!(title in coreSummaryLabels)) {
    throw new BusinessAnalysisProviderError(
      'INVALID_MODEL_OUTPUT',
      '销售复盘返回了未知的总结章节。',
      true,
    );
  }
  return coreSummaryLabels[title as keyof typeof coreSummaryLabels];
}

/** 将长转写分成最多三个有界主动检索查询。 */
export function buildBusinessRetrievalQueries(
  contentFocus: string,
  segments: readonly { text: string }[],
): string[] {
  const transcript = segments
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join('\n');
  if (!transcript) return [];
  const size = Math.max(1, Math.ceil(transcript.length / 3));
  return [0, size, size * 2]
    .map((start) => transcript.slice(start, start + Math.min(size, 2_500)).trim())
    .filter(Boolean)
    .map((part) => `${contentFocus.slice(0, 600)}\n对话片段：${part}`);
}

type BusinessAnalysisWorkerOptions = {
  repository: BusinessAnalysisRepository;
  knowledgeRepository: KnowledgeRepository;
  embeddings: Pick<DashScopeEmbeddings, 'embedQuery'>;
  embeddingModel: string;
  agent: SalesAnalysisAgent;
};

/** 单并发轮询并执行销售复盘任务。 */
export class BusinessAnalysisWorker {
  private active?: Promise<void>;
  private pumping = false;
  private stopping = false;
  private timer?: NodeJS.Timeout;

  constructor(private readonly options: BusinessAnalysisWorkerOptions) {}

  async start(): Promise<void> {
    if (this.timer) return;
    this.stopping = false;
    await this.options.repository.resetInterrupted();
    this.timer = setInterval(() => void this.pump(), 750);
    this.timer.unref();
    void this.pump();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (this.active) await Promise.allSettled([this.active]);
  }

  private async pump(): Promise<void> {
    if (this.pumping || this.stopping || this.active) return;
    this.pumping = true;
    try {
      const job = await this.options.repository.claim();
      if (!job) return;
      const execution = this.execute(job).finally(() => {
        if (this.active === execution) this.active = undefined;
        if (!this.stopping) void this.pump();
      });
      this.active = execution;
    } catch (error) {
      console.error('Failed to claim business analysis job', {
        error: error instanceof Error ? error.name : 'UnknownError',
      });
    } finally {
      this.pumping = false;
    }
  }

  private async execute(job: ClaimedBusinessAnalysisJob) {
    try {
      if (job.segments.length === 0) {
        throw new BusinessAnalysisProviderError(
          'INVALID_MODEL_OUTPUT',
          '确认转写中没有可分析的正文。',
          false,
        );
      }
      const retrieved = new Map<string, RetrievalChunk>();
      const search = async (query: string) => {
        if (job.knowledgeBaseIds.length === 0) return [];
        const embedding = await this.options.embeddings.embedQuery(query);
        const chunks = await this.options.knowledgeRepository.searchMany(
          job.knowledgeBaseIds,
          embedding,
          this.options.embeddingModel,
        );
        for (const chunk of chunks) retrieved.set(chunk.id, chunk);
        return chunks;
      };
      const plannedQueries = await this.options.agent.planRetrievalQueries(job);
      const queries =
        plannedQueries.length > 0
          ? plannedQueries
          : buildBusinessRetrievalQueries(job.settings.contentFocus, job.segments);
      await this.options.repository.updateProgress(job.id, 15);
      for (const query of queries) await search(query);
      await this.options.repository.updateProgress(job.id, 35);
      const result = await this.options.agent.analyze({
        job,
        preRetrieved: [...retrieved.values()],
        searchKnowledge: search,
      });
      const segmentIds = new Set(job.segments.map((segment) => segment.id));
      const customTags = new Set(job.settings.customTags);
      for (const tag of result.tags) {
        if (tag.evidenceSegmentIds.some((id) => !segmentIds.has(id))) {
          throw new BusinessAnalysisProviderError(
            'INVALID_MODEL_OUTPUT',
            '销售复盘引用了不存在的转写片段。',
            true,
          );
        }
        if (tag.citedChunkIds.some((id) => !retrieved.has(id))) {
          throw new BusinessAnalysisProviderError(
            'INVALID_MODEL_OUTPUT',
            '销售复盘引用了未检索或未授权的知识块。',
            true,
          );
        }
        if (
          (tag.category === 'custom' && (!tag.customLabel || !customTags.has(tag.customLabel))) ||
          (tag.category !== 'custom' && tag.customLabel !== null)
        ) {
          throw new BusinessAnalysisProviderError(
            'INVALID_MODEL_OUTPUT',
            '销售复盘返回了未配置的自定义标签。',
            true,
          );
        }
      }
      if (!job.segments.some((segment) => segment.role)) {
        result.limitations = [...new Set([...result.limitations, '本次分析未使用角色识别结果。'])];
      }
      if (!job.segments.some((segment) => segment.emotion)) {
        result.limitations = [...new Set([...result.limitations, '本次分析未使用情绪识别结果。'])];
      }
      if (job.knowledgeBaseIds.length === 0) {
        result.limitations = [...new Set([...result.limitations, '本次分析未使用知识库。'])];
      }
      await this.options.repository.updateProgress(job.id, 92);
      await this.options.repository.publish(
        job,
        {
          ...result,
          summarySections: result.summarySections.map((section) => ({
            ...section,
            title: localizeCoreSummaryTitle(section.title),
          })),
        },
        retrieved,
      );
    } catch (error) {
      const known = error instanceof BusinessAnalysisProviderError;
      await this.options.repository.fail(
        job.id,
        known ? error.code : 'INTERNAL_ERROR',
        known ? error.message : '销售复盘失败，请稍后重试。',
        known ? error.retryable : true,
      );
      console.error('Business analysis failed', {
        audioFileId: job.audioFileId,
        groupId: job.groupId,
        jobId: job.id,
        code: known ? error.code : 'INTERNAL_ERROR',
        message: known ? error.message : 'Unexpected business analysis failure.',
      });
    }
  }
}
