/**
 * 知识类别应用服务。
 *
 * 编排目录维护、人工确认与已有文档的按需建议。
 *
 * Responsibilities:
 * - 让 HTTP 依赖应用能力而非 SQL 仓储。
 * - 保持模型建议和确认覆盖的独立生命周期。
 *
 * Notes:
 * - 现有文档只在用户请求时调用分类模型。
 */
import type { KnowledgeCategoryRepository } from './categoryRepository.ts';
import type { KnowledgeClassifier } from './classifier.ts';
import type { AiExecutionReporter } from '../../ai-observability/executionReporter.ts';
import type {
  DocumentClassificationUpdate,
  KnowledgeCategoryCreate,
  KnowledgeCategoryUpdate,
} from '@echowave/contracts';
import type { KnowledgeSearchPort } from '../retrieval/port.ts';
/** 类别管理与分类操作的应用入口。 */
export class KnowledgeCategoryService {
  constructor(
    private readonly repository: KnowledgeCategoryRepository,
    private readonly classifier: KnowledgeClassifier,
    private readonly reporter: AiExecutionReporter,
    private readonly search: KnowledgeSearchPort,
  ) {}
  /** 问答选择器只显示当前知识库实际可检索类别。 */
  async available(knowledgeId: string) {
    return { items: (await this.search.availableCategories?.([knowledgeId]))?.categories ?? [] };
  }
  /** 列出包括停用项的租户类别。 */
  list() {
    return this.repository.list();
  }
  /** 创建自定义类别。 */
  create(input: KnowledgeCategoryCreate) {
    return this.repository.create(input);
  }
  /** 按版本更新或停用类别。 */
  update(id: string, input: KnowledgeCategoryUpdate) {
    return this.repository.update(id, input);
  }
  /** 读取活动文档分类。 */
  getClassification(knowledgeId: string, documentId: string) {
    return this.repository.getClassification(knowledgeId, documentId);
  }
  /** 人工确认或恢复继承。 */
  updateClassification(
    knowledgeId: string,
    documentId: string,
    input: DocumentClassificationUpdate,
  ) {
    return this.repository.updateClassification(knowledgeId, documentId, input);
  }
  /** 对已有文档按需产生建议，旧模型请求不能覆盖新的确认或 revision。 */
  async suggest(knowledgeId: string, documentId: string) {
    const { classification, chunks, title } = await this.repository.classificationSample(
      knowledgeId,
      documentId,
    );
    const report = this.reporter.start({
      kind: 'knowledge-ingestion',
      name: 'EchoWave knowledge classification',
      metadata: { knowledgeBaseId: knowledgeId, documentId, revisionId: classification.revisionId },
    });
    try {
      const suggestion = await this.classifier.suggest(
        title,
        chunks,
        (await this.repository.list()).items,
        report,
      );
      const result = await this.repository.saveSuggestion(
        knowledgeId,
        documentId,
        classification.revisionId,
        classification.version,
        suggestion,
      );
      await report.finish({
        status: 'completed',
        metadata: { classificationStatus: suggestion.status },
      });
      return result;
    } catch (error) {
      await report.finish({ status: 'failed', error });
      throw error;
    }
  }
}
