/** Synchronous icon stand-in that keeps component tests independent of font loading. */
import { Text } from 'react-native';

type IoniconsMockProps = {
  accessibilityLabel?: string;
  name: string;
};

export default function IoniconsMock({
  accessibilityLabel,
  name,
}: IoniconsMockProps) {
  return <Text accessibilityLabel={accessibilityLabel}>{name}</Text>;
}
