/**
 * 类别检索范围策略。
 *
 * 在调用方知识库白名单内约束模型类别选择和一次性扩大检索。
 *
 * Responsibilities:
 * - 区分显式筛选、自动路由和证据不足兜底。
 * - 排除普通事实任务中的测试样例。
 *
 * Notes:
 * - 本策略不授予知识库权限，调用预算由工作流计数。
 */
import { KnowledgeCategoryFilterSchema, type KnowledgeCategory } from '@echowave/contracts';

/** 模型工具提供的类别选择；扩大检索必须显式表明证据不足。 */
export type CategorySearchChoice = { categoryIds?: string[]; broaden?: boolean };
/** 已校验的数据库范围与审计原因。 */
export type CategorySearchFilter = {
  categoryIds?: string[];
  includeTestSamples: boolean;
  reason: string;
};
/** 类别目录与知识版本快照，不包含文档正文。 */
export type CategoryCatalogue = {
  categories: KnowledgeCategory[];
  versions: { id: string; version: number; categoryVersion: number }[];
};
/** 只有明确的测试或纠错样例问题才能自动使用测试类别。 */
export function isTestSampleQuestion(question: string): boolean {
  return /测试样例|纠错样例|测试用例|评测|evaluation|test\s+(case|sample|fixture)|TC\d{3}/i.test(
    question,
  );
}
/** 一次问答或业务分析共享的兜底状态，防止并行分支各自扩大范围。 */
export class CategoryRetrievalPolicy {
  private expanded = false;
  private searched = false;
  readonly includeTestSamples: boolean;
  constructor(
    readonly catalogue: readonly KnowledgeCategory[],
    private readonly explicitIds?: string[],
    allowTestSamples = false,
  ) {
    this.includeTestSamples =
      allowTestSamples ||
      Boolean(
        explicitIds?.some((id) => catalogue.some((item) => item.id === id && item.key === 'test')),
      );
    if (explicitIds) this.validate(explicitIds, true);
  }
  private validate(ids: string[], allowInactive = false) {
    KnowledgeCategoryFilterSchema.parse(ids);
    if (
      ids.some(
        (id) =>
          !this.catalogue.some(
            (item) =>
              item.id === id &&
              (allowInactive || item.active) &&
              (this.includeTestSamples || item.key !== 'test'),
          ),
      )
    )
      throw new Error('Select only categories from the allowed catalogue.');
  }
  /** 缺少模型选择时使用有界类别默认值，不立即查询整个白名单。 */
  private defaults(query: string): string[] | undefined {
    const eligible = this.catalogue.filter(
      (item) => item.active && (this.includeTestSamples || item.key !== 'test'),
    );
    if (!eligible.length) return this.catalogue.length ? [] : undefined;
    const hints: [string, RegExp][] = [
      ['terminology', /术语|热词|纠错|误识别|ASR/i],
      ['product', /产品|商品|价格|规格|成分|服务|product/i],
      ['sop', /流程|业务规则|SOP|操作|售后/i],
      ['compliance', /合规|风险|禁止|承诺|compliance/i],
      ['case', /案例|话术|异议|回应/i],
      ['test', /样例|评测|测试/i],
    ];
    const matched = hints
      .filter(([, pattern]) => pattern.test(query))
      .flatMap(([key]) => eligible.filter((item) => item.key === key).map((item) => item.id))
      .slice(0, 3);
    return matched.length
      ? matched
      : eligible.find((item) => item.key === 'general')
        ? [eligible.find((item) => item.key === 'general')!.id]
        : eligible.slice(0, 3).map((item) => item.id);
  }
  /** 校验工具选择；显式用户筛选永远不被模型扩大。 */
  resolve(query: string, choice: CategorySearchChoice = {}): CategorySearchFilter {
    if (this.explicitIds) {
      this.searched = true;
      return {
        categoryIds: this.explicitIds,
        includeTestSamples: this.includeTestSamples,
        reason: 'explicit',
      };
    }
    if (choice.broaden) {
      const expanded = this.fallback('evidence-insufficient');
      if (!expanded)
        throw new Error(
          'The one-time expansion is unavailable. Use selected categories and existing evidence.',
        );
      return expanded;
    }
    const categoryIds = choice.categoryIds?.length ? choice.categoryIds : this.defaults(query);
    if (categoryIds?.length) this.validate(categoryIds);
    this.searched = true;
    return {
      categoryIds,
      includeTestSamples: this.includeTestSamples,
      reason: choice.categoryIds?.length ? 'auto' : 'default-route',
    };
  }
  /** 零命中和证据不足共用一次扩大额度；不得绕过显式筛选。 */
  fallback(reason: 'zero-hits' | 'evidence-insufficient'): CategorySearchFilter | undefined {
    if (this.explicitIds || this.expanded || !this.searched || !this.catalogue.length)
      return undefined;
    this.expanded = true;
    return { includeTestSamples: this.includeTestSamples, reason };
  }
}
