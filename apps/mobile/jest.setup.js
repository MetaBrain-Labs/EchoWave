/* global jest */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('react-native-reanimated', () => {
  const native = require('react-native');
  const interpolate = (value, inputRange, outputRange) => {
    const start = inputRange[0];
    const end = inputRange[inputRange.length - 1];
    const startOutput = outputRange[0];
    const endOutput = outputRange[outputRange.length - 1];
    const progress = Math.max(0, Math.min(1, (value - start) / (end - start)));
    return startOutput + (endOutput - startOutput) * progress;
  };
  const animated = {
    View: native.View,
    createAnimatedComponent: (component) => component,
  };
  return {
    __esModule: true,
    default: animated,
    cancelAnimation: () => undefined,
    Easing: { inOut: (easing) => easing, sin: (value) => value },
    interpolate,
    useAnimatedStyle: (factory) => factory(),
    useSharedValue: (value) => ({ value }),
    withRepeat: (animation) => animation,
    withTiming: (value) => value,
  };
});
