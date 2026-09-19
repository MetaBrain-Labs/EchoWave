/**
 * 功能说明文案键与要点枚举。
 *
 * 为尚无引导的主功能页提供稳定的文案命名空间和要点键，不进入引导步进命名空间。
 *
 * Responsibilities:
 * - 声明支持的说明命名空间。
 * - 生成按序的要点文案键。
 *
 * Notes:
 * - 命名空间与页面一一对应，避免多个页面共用同一份说明而语义漂移。
 */
import type { TranslationKey } from '@/shared/i18n/translations';

/** 支持说明卡片的功能页命名空间。 */
export const GUIDE_HINT_NAMESPACES = [
  'guideHint.createHub',
  'guideHint.analysisCreate',
  'guideHint.analysisDetail',
] as const;

export type GuideHintNamespace = (typeof GUIDE_HINT_NAMESPACES)[number];

/** 每个说明卡片的要点数量上限；缺失的要点键会渲染成键名，因此必须与文案同步维护。 */
export const GUIDE_HINT_POINT_COUNT = 5;

/** 按序返回某个命名空间的要点文案键。 */
export function guideHintPointKeys(namespace: GuideHintNamespace): TranslationKey[] {
  return Array.from(
    { length: GUIDE_HINT_POINT_COUNT },
    (_, index) => `${namespace}.point${index + 1}` as TranslationKey,
  );
}

/** 返回某个命名空间的标题文案键。 */
export function guideHintTitleKey(namespace: GuideHintNamespace): TranslationKey {
  return `${namespace}.title` as TranslationKey;
}
