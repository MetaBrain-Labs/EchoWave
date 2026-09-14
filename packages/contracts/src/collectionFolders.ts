/**
 * 收集规则文件夹与目录契约。
 *
 * Responsibilities:
 * - 表达目录组织及冻结的规则归属，不改变独立案例检索。
 * Notes:
 * - 目录条目引用现有文档接口，避免产生第二套文档状态。
 */
import { z } from 'zod';
import { EntityIdSchema } from './common.ts';
import { CollectionRuleInputSchema } from './collection.ts';

/** 来源事件冻结身份及配置；旧事件仍可按原输入读取。 */
export const FrozenCollectionRuleSchema = z
  .object({
    id: EntityIdSchema,
    version: z.number().int().positive(),
    input: CollectionRuleInputSchema,
  })
  .strict();
/** 同一案例可以归属多个稳定规则文件夹。 */
export const CaseFolderMembershipSchema = z.object({
  folderId: EntityIdSchema,
  caseId: EntityIdSchema,
  ruleVersion: z.number().int().positive().nullable(),
  ruleSnapshot: CollectionRuleInputSchema.nullable(),
  origin: z.enum(['matched', 'organized', 'legacy', 'manual']),
});
/** 规则改名实时显示，目标库变化不迁移原目录。 */
export const CollectionFolderSchema = z.object({
  id: EntityIdSchema,
  knowledgeBaseId: EntityIdSchema,
  kind: z.enum(['rule', 'legacy', 'manual']),
  name: z.string(),
  ruleId: EntityIdSchema.nullable(),
  groupId: EntityIdSchema.nullable(),
  caseCount: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
});
/** 普通文件与收集文件夹共存，文档详情沿用原接口。 */
export const KnowledgeDirectoryEntrySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('document'),
    documentId: EntityIdSchema,
    updatedAt: z.string().datetime(),
  }),
  z.object({
    kind: z.literal('folder'),
    folder: CollectionFolderSchema,
    updatedAt: z.string().datetime(),
  }),
]);
/** 目录查询结果。 */
export const KnowledgeDirectorySchema = z.object({ items: z.array(KnowledgeDirectoryEntrySchema) });
/** 文件夹内保留文档及案例身份与乐观版本。 */
export const CollectionFolderContentsSchema = z.object({
  folder: CollectionFolderSchema,
  items: z.array(
    z.object({
      caseId: EntityIdSchema,
      documentId: EntityIdSchema.nullable(),
      groupId: EntityIdSchema,
      title: z.string(),
      version: z.number().int().positive(),
    }),
  ),
});
/** 历史整理只允许同库、同来源分组，并逐项检查当前版本。 */
export const OrganizeCollectionCasesSchema = z
  .object({
    ruleId: EntityIdSchema,
    items: z
      .array(
        z.object({ id: EntityIdSchema, expectedVersion: z.number().int().positive() }).strict(),
      )
      .min(1)
      .max(100)
      .refine((items) => new Set(items.map((item) => item.id)).size === items.length),
  })
  .strict();
/** 目录身份类型由共享契约推断。 */
export type FrozenCollectionRule = z.infer<typeof FrozenCollectionRuleSchema>;
/** 文件夹类型由共享契约推断。 */
export type CollectionFolder = z.infer<typeof CollectionFolderSchema>;
/** 目录条目类型由共享契约推断。 */
export type KnowledgeDirectoryEntry = z.infer<typeof KnowledgeDirectoryEntrySchema>;
/** 整理输入类型由共享契约推断。 */
export type OrganizeCollectionCases = z.infer<typeof OrganizeCollectionCasesSchema>;
