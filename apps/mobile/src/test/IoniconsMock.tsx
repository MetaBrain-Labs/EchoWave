/**
 * Ionicons 测试替身。
 *
 * 为组件测试提供同步、可查询的图标输出，避免字体加载和原生资源影响测试稳定性。
 *
 * Responsibilities:
 * - 模拟测试使用的 Ionicons 渲染接口。
 *
 * Notes:
 * - 仅供 Jest 环境使用。
 */
import { Text } from 'react-native';

type IoniconsMockProps = {
  accessibilityLabel?: string;
  name: string;
  size?: number;
};

export default function IoniconsMock({ accessibilityLabel, name, size }: IoniconsMockProps) {
  return (
    <Text
      accessibilityLabel={accessibilityLabel}
      style={size === undefined ? undefined : { height: size, width: size }}
      testID={`icon-${name}`}
    >
      {name}
    </Text>
  );
}
