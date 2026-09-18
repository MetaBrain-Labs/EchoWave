/**
 * 渲染树文本约束断言辅助。
 *
 * React Native 要求文本渲染在 Text 内，直接在 View 等容器下放字符串会触发
 * "Text strings must be rendered within a <Text> component"。
 *
 * Responsibilities:
 * - 在指定子树内找出容器组件下的裸字符串或数字子节点。
 *
 * Notes:
 * - 只用于测试；Text 自身的字符串子节点是合法文本，不参与判定。
 */

/** 渲染树节点：react-test-renderer 序列化后的最小结构。 */
export type RenderedNode = { children?: unknown[]; type?: unknown };

/** 容器类宿主组件：其直接子节点不允许是字符串或数字。 */
function isTextContainer(node: RenderedNode) {
  return typeof node.type === 'string' && node.type !== 'Text';
}

/**
 * 收集子树中容器下的裸文本违规。
 *
 * Text 内部的字符串合法；容器（View、Pressable、ScrollView 等）直接持有字符串即违规。
 */
export function findRawTextViolations(node: RenderedNode, violations: RenderedNode[] = []) {
  const raw = (node.children ?? []).filter(
    (child) => typeof child === 'string' || typeof child === 'number',
  );
  if (raw.length && isTextContainer(node)) violations.push(node);
  for (const child of node.children ?? []) {
    if (typeof child === 'object' && child !== null && 'children' in child) {
      findRawTextViolations(child as RenderedNode, violations);
    }
  }
  return violations;
}
