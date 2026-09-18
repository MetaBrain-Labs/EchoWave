/**
 * 知识语义类别契约。
 *
 * 定义租户类别目录、文档与工作表分类、人工确认和有界检索筛选。
 *
 * Responsibilities:
 * - 校验类别维护与分类并发更新输入。
 * - 保持建议分类和生效分类相互独立。
 *
 * Notes:
 * - 类别不授予知识库访问权限。
 */
import { z } from 'zod';
import { EntityIdSchema } from './common.ts';

/** 租户可维护的语义类别。 */
export const KnowledgeCategorySchema = z.object({
  id: EntityIdSchema,
  key: z.string().nullable(),
  name: z.string(),
  description: z.string(),
  active: z.boolean(),
  version: z.number().int().nonnegative(),
});
/** 类别目录响应。 */
export const KnowledgeCategoryListSchema = z.object({ items: z.array(KnowledgeCategorySchema) });
/** 新类别的用途说明也用于模型路由。 */
export const KnowledgeCategoryCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(1000),
});
/** 类别维护必须携带读取时版本。 */
export const KnowledgeCategoryUpdateSchema = KnowledgeCategoryCreateSchema.partial()
  .extend({
    active: z.boolean().optional(),
    expectedVersion: z.number().int().nonnegative(),
  })
  .refine(
    (value) =>
      value.name !== undefined || value.description !== undefined || value.active !== undefined,
    { message: 'At least one category field must be provided.' },
  );
/** 一次检索可显式选择任意数量的不重复类别；数量上限由服务端目录规模决定。 */
export const KnowledgeCategoryFilterSchema = z
  .array(EntityIdSchema)
  .min(1)
  .max(200)
  .refine((ids) => new Set(ids).size === ids.length, { message: 'Category IDs must be unique.' });
/** 工作表覆盖类别。 */
export const SheetCategoryAssignmentSchema = z.object({
  sheet: z.string().min(1).max(200),
  categoryId: EntityIdSchema,
});
const SheetAssignmentsSchema = z
  .array(SheetCategoryAssignmentSchema)
  .max(50)
  .refine((items) => new Set(items.map((item) => item.sheet)).size === items.length, {
    message: 'Sheet names must be unique.',
  });
/** 模型建议未确认前不能成为生效分类。 */
export const ClassificationSuggestionSchema = z.object({
  status: z.enum(['pending', 'confirmed', 'failed']),
  documentCategoryId: EntityIdSchema.nullable(),
  sheets: SheetAssignmentsSchema,
  message: z.string().max(500).default(''),
});
/** 当前活动 revision 的分类及可覆盖工作表。 */
export const DocumentClassificationSchema = z.object({
  revisionId: EntityIdSchema,
  version: z.number().int().nonnegative(),
  documentVersion: z.number().int().nonnegative(),
  defaultCategoryId: EntityIdSchema,
  documentCategoryId: EntityIdSchema.nullable(),
  sheets: z.array(z.string()),
  sheetAssignments: SheetAssignmentsSchema,
  suggestion: ClassificationSuggestionSchema.nullable(),
});
/** 完整替换本次 revision 的人工分类覆盖；空覆盖恢复继承。 */
export const DocumentClassificationUpdateSchema = z.object({
  revisionId: EntityIdSchema,
  expectedVersion: z.number().int().nonnegative(),
  expectedDocumentVersion: z.number().int().nonnegative(),
  documentCategoryId: EntityIdSchema.nullable(),
  sheetAssignments: SheetAssignmentsSchema,
  confirmSuggestion: z.boolean().default(false),
});
/** 类别与分类的共享类型。 */
export type KnowledgeCategory = z.infer<typeof KnowledgeCategorySchema>;
export type KnowledgeCategoryCreate = z.infer<typeof KnowledgeCategoryCreateSchema>;
export type KnowledgeCategoryUpdate = z.infer<typeof KnowledgeCategoryUpdateSchema>;
export type DocumentClassification = z.infer<typeof DocumentClassificationSchema>;
export type DocumentClassificationUpdate = z.infer<typeof DocumentClassificationUpdateSchema>;
export type ClassificationSuggestion = z.infer<typeof ClassificationSuggestionSchema>;
