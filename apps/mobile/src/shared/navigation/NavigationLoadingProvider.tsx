/**
 * 导航加载状态 provider。
 *
 * 为页面初始异步请求提供延迟出现的全局加载遮罩，避免快速请求闪烁和重复状态实现。
 *
 * Responsibilities:
 * - 协调并发加载任务计数与延迟显示。
 * - 向页面暴露开始和结束加载的 Hook。
 *
 * Notes:
 * - 不替代页面自身的数据错误与重试状态。
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import {
  colors,
  fontFamilies,
  radii,
  spacing,
  textColors,
  typography,
} from '@/shared/theme/tokens';

export const navigationLoadingDelayMs = 150;

type NavigationLoadingContextValue = {
  runWithLoading: <Result>(operation: () => Result | Promise<Result>) => Promise<Result>;
};

const NavigationLoadingContext = createContext<NavigationLoadingContextValue | null>(null);

async function runWithoutOverlay<Result>(
  operation: () => Result | Promise<Result>,
): Promise<Result> {
  return await operation();
}

const barColors = ['#22B8CF', colors.success, '#5B8CFF', '#B47CF6', '#FFB84D'];

function LivelyLoadingMark() {
  const [barValues] = useState(() => barColors.map(() => new Animated.Value(0)));
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

/** 为子树提供可计数、按真实请求生命周期展示的导航加载状态。 */
export function NavigationLoadingProvider({ children }: { children: React.ReactNode }) {
  const { t } = useAppLanguage();
  const [visible, setVisible] = useState(false);
  const pendingOperations = useRef(0);
  const showTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(
    () => () => {
      if (showTimer.current) clearTimeout(showTimer.current);
    },
    [],
  );

  const runWithLoading = useCallback(async <Result,>(operation: () => Result | Promise<Result>) => {
    pendingOperations.current += 1;
    if (pendingOperations.current === 1) {
      showTimer.current = setTimeout(() => {
        showTimer.current = undefined;
        if (pendingOperations.current > 0) setVisible(true);
      }, navigationLoadingDelayMs);
    }

    try {
      return await operation();
    } finally {
      pendingOperations.current = Math.max(0, pendingOperations.current - 1);
      if (pendingOperations.current === 0) {
        if (showTimer.current) clearTimeout(showTimer.current);
        showTimer.current = undefined;
        setVisible(false);
      }
    }
  }, []);

  return (
    <NavigationLoadingContext.Provider value={{ runWithLoading }}>
      {children}
      {visible ? (
        <View
          accessibilityLabel={t('common.pageLoading')}
          accessibilityLiveRegion="polite"
          accessibilityRole="progressbar"
          accessibilityViewIsModal
          style={styles.overlay}
        >
          <View style={styles.indicatorCard}>
            <LivelyLoadingMark />
            <Text style={styles.loadingText}>{t('common.loading')}</Text>
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
    throw new Error('useNavigationLoading must be used within NavigationLoadingProvider');
  }
  return context;
}

/** 让网络型页面接入初始请求遮罩；独立测试未挂载 provider 时保持原请求语义。 */
export function useInitialRequestLoading() {
  return useContext(NavigationLoadingContext)?.runWithLoading ?? runWithoutOverlay;
}

const styles = StyleSheet.create({
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(250, 250, 250, 0.92)',
    bottom: 0,
    elevation: 20,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 100,
  },
  indicatorCard: {
    alignItems: 'center',
    backgroundColor: 'transparent',
    gap: spacing.base,
    minWidth: 128,
    padding: spacing.lg,
  },
  loadingMark: {
    alignItems: 'center',
    height: 64,
    justifyContent: 'center',
    width: 72,
  },
  pulseRing: {
    borderColor: colors.success,
    borderRadius: radii.round,
    borderWidth: 2,
    height: 56,
    position: 'absolute',
    width: 56,
  },
  barRow: {
    alignItems: 'center',
    flexDirection: 'row',
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
    fontWeight: 'bold',
  },
});
