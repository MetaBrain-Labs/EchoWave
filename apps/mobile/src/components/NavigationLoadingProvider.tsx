/**
 * 导航加载状态 provider。
 *
 * 为路由切换和未来异步操作提供具有最短展示时间的全局加载遮罩，避免快速闪烁和重复状态实现。
 *
 * Responsibilities:
 * - 协调加载任务计数与最短可见时长。
 * - 向页面暴露开始和结束加载的 Hook。
 *
 * Notes:
 * - 不替代页面自身的数据错误与重试状态。
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";

import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from "../theme/tokens";

export const minimumNavigationLoadingMs = 700;

type NavigationLoadingContextValue = {
  runWithLoading: <Result>(
    operation: () => Result | Promise<Result>,
  ) => Promise<Result>;
};

const NavigationLoadingContext =
  createContext<NavigationLoadingContextValue | null>(null);

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

const barColors = ["#22B8CF", colors.success, "#5B8CFF", "#B47CF6", "#FFB84D"];

function LivelyLoadingMark() {
  const [barValues] = useState(() =>
    barColors.map(() => new Animated.Value(0)),
  );
  const [pulseValue] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const barAnimations = barValues.map((value, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(index * 60),
          Animated.timing(value, {
            duration: 220,
            easing: Easing.inOut(Easing.ease),
            toValue: 1,
            useNativeDriver: true,
          }),
          Animated.timing(value, {
            duration: 220,
            easing: Easing.inOut(Easing.ease),
            toValue: 0,
            useNativeDriver: true,
          }),
          Animated.delay((barColors.length - index - 1) * 60),
        ]),
      ),
    );
    const pulseAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseValue, {
          duration: 500,
          easing: Easing.out(Easing.ease),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(pulseValue, {
          duration: 500,
          easing: Easing.in(Easing.ease),
          toValue: 0,
          useNativeDriver: true,
        }),
      ]),
    );

    barAnimations.forEach((animation) => animation.start());
    pulseAnimation.start();
    return () => {
      barAnimations.forEach((animation) => animation.stop());
      pulseAnimation.stop();
    };
  }, [barValues, pulseValue]);

  return (
    <View style={styles.loadingMark} testID="lively-loading-mark">
      <Animated.View
        style={[
          styles.pulseRing,
          {
            opacity: pulseValue.interpolate({
              inputRange: [0, 1],
              outputRange: [0.65, 0.08],
            }),
            transform: [
              {
                scale: pulseValue.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.82, 1.18],
                }),
              },
            ],
          },
        ]}
      />
      <View style={styles.barRow}>
        {barValues.map((value, index) => (
          <Animated.View
            key={barColors[index]}
            style={[
              styles.loadingBar,
              {
                backgroundColor: barColors[index],
                opacity: value.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.55, 1],
                }),
                transform: [
                  {
                    scaleY: value.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.38, 1],
                    }),
                  },
                ],
              },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

/** 为子树提供可计数、具有最短展示时长的导航加载状态。 */
export function NavigationLoadingProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  const operationId = useRef(0);

  const runWithLoading = useCallback(
    async <Result,>(operation: () => Result | Promise<Result>) => {
      const currentOperationId = operationId.current + 1;
      operationId.current = currentOperationId;
      const startedAt = Date.now();
      setVisible(true);

      try {
        return await operation();
      } finally {
        const remainingTime = Math.max(
          minimumNavigationLoadingMs - (Date.now() - startedAt),
          0,
        );
        await wait(remainingTime);
        if (operationId.current === currentOperationId) {
          setVisible(false);
        }
      }
    },
    [],
  );

  return (
    <NavigationLoadingContext.Provider value={{ runWithLoading }}>
      {children}
      {visible ? (
        <View
          accessibilityLabel="页面正在加载"
          accessibilityLiveRegion="polite"
          accessibilityRole="progressbar"
          accessibilityViewIsModal
          style={styles.overlay}
        >
          <View style={styles.indicatorCard}>
            <LivelyLoadingMark />
            <Text style={styles.loadingText}>加载中</Text>
          </View>
        </View>
      ) : null}
    </NavigationLoadingContext.Provider>
  );
}

/** 读取导航加载接口；在 provider 外调用会立即暴露编程错误。 */
export function useNavigationLoading() {
  const context = useContext(NavigationLoadingContext);
  if (!context) {
    throw new Error(
      "useNavigationLoading must be used within NavigationLoadingProvider",
    );
  }
  return context;
}

const styles = StyleSheet.create({
  overlay: {
    alignItems: "center",
    backgroundColor: "rgba(250, 250, 250, 0.92)",
    bottom: 0,
    elevation: 20,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 100,
  },
  indicatorCard: {
    alignItems: "center",
    backgroundColor: "transparent",
    gap: spacing.base,
    minWidth: 128,
    padding: spacing.lg,
  },
  loadingMark: {
    alignItems: "center",
    height: 64,
    justifyContent: "center",
    width: 72,
  },
  pulseRing: {
    borderColor: colors.success,
    borderRadius: radii.round,
    borderWidth: 2,
    height: 56,
    position: "absolute",
    width: 56,
  },
  barRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    height: 36,
  },
  loadingBar: {
    borderRadius: radii.round,
    height: 32,
    width: 4,
  },
  loadingText: {
    ...typography.heading2,
    color: textColors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: "bold",
  },
});
