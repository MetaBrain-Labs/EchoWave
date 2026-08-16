/** Synchronous icon stand-in that keeps component tests independent of font loading. */
import { Text } from 'react-native';

type IoniconsMockProps = {
  accessibilityLabel?: string;
  name: string;
  size?: number;
};

export default function IoniconsMock({
  accessibilityLabel,
  name,
  size,
}: IoniconsMockProps) {
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
