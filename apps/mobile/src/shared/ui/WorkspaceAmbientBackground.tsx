/**
 * 已登录工作区环境背景。
 *
 * 在工作区页面下方绘制轻量网格和缓慢呼吸的蓝色光晕，桌面 Web 使用 CSS 渐变，原生端用普通视图。
 *
 * Responsibilities:
 * - 为已登录页面提供统一的浅色底、低对比网格和环境光。
 * - 通过 UI 线程上的 transform / opacity 动画营造缓慢变化，并遵守减少动态效果偏好。
 *
 * Notes:
 * - 仅由已登录工作区外壳或路由场景挂载，认证表单背景不受影响。
 * - 不加载位图，不动画滤镜或渐变属性。
 */
import { useEffect, useState } from 'react';
import {
  AppState,
  AccessibilityInfo,
  Platform,
  StyleSheet,
  View,
  useWindowDimensions,
  type ViewStyle,
} from 'react-native';
import { colors } from '@/shared/theme/tokens';
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

const GRID_SIZE = 96;

/** 绘制只装饰背景、不拦截页面交互的环境层。 */
export function WorkspaceAmbientBackground({ active = true }: { active?: boolean }) {
  const { height, width } = useWindowDimensions();
  const leftMotion = useSharedValue(0);
  const topMotion = useSharedValue(0);
  const centerMotion = useSharedValue(0);
  const [reducedMotion, setReducedMotion] = useState<boolean | null>(null);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const web = Platform.OS === 'web';

  useEffect(() => {
    let mounted = true;
    void Promise.resolve(AccessibilityInfo.isReduceMotionEnabled?.())
      .then((enabled) => {
        if (mounted) setReducedMotion(enabled === true);
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (enabled) => {
      setReducedMotion(enabled);
    });
    return () => {
      mounted = false;
      subscription?.remove();
    };
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setAppActive(state === 'active');
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    // 系统偏好加载完成且允许动态效果后才启动，避免减少动态效果时闪动。
    if (!active || !appActive || reducedMotion !== false) {
      cancelAnimation(leftMotion);
      cancelAnimation(topMotion);
      cancelAnimation(centerMotion);
      leftMotion.value = 0;
      topMotion.value = 0;
      centerMotion.value = 0;
      return undefined;
    }

    leftMotion.value = withRepeat(
      withTiming(1, { duration: 14_000, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
    topMotion.value = withRepeat(
      withTiming(1, { duration: 16_000, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
    centerMotion.value = withRepeat(
      withTiming(1, { duration: 18_000, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );

    return () => {
      cancelAnimation(leftMotion);
      cancelAnimation(topMotion);
      cancelAnimation(centerMotion);
    };
  }, [active, appActive, centerMotion, leftMotion, reducedMotion, topMotion]);

  const leftAnimation = useAnimatedStyle(() => ({
    opacity: interpolate(leftMotion.value, [0, 1], [0.72, 0.96]),
    transform: [
      { translateX: interpolate(leftMotion.value, [0, 1], [-width * 0.018, width * 0.04]) },
      { translateY: interpolate(leftMotion.value, [0, 1], [-height * 0.01, height * 0.03]) },
      { scale: interpolate(leftMotion.value, [0, 1], [0.96, 1.07]) },
    ],
  }));
  const topAnimation = useAnimatedStyle(() => ({
    opacity: interpolate(topMotion.value, [0, 1], [0.7, 0.92]),
    transform: [
      { translateX: interpolate(topMotion.value, [0, 1], [0, -width * 0.03]) },
      { translateY: interpolate(topMotion.value, [0, 1], [-height * 0.02, height * 0.04]) },
      { scale: interpolate(topMotion.value, [0, 1], [1, 1.08]) },
    ],
  }));
  const centerAnimation = useAnimatedStyle(() => ({
    opacity: interpolate(centerMotion.value, [0, 1], [0.52, 0.82]),
    transform: [
      { translateX: interpolate(centerMotion.value, [0, 1], [-width * 0.02, width * 0.02]) },
      { translateY: interpolate(centerMotion.value, [0, 1], [0, -height * 0.03]) },
      { scale: interpolate(centerMotion.value, [0, 1], [0.98, 1.06]) },
    ],
  }));

  return (
    <View
      accessible={false}
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        styles.backgroundLayer,
        web ? webAmbientBackground : styles.nativeBackground,
      ]}
      testID="workspace-ambient-background"
    >
      <Animated.View
        style={[
          styles.glow,
          {
            height: width * 0.7,
            left: -width * 0.36,
            top: height * 0.06,
            width: width * 0.7,
          },
          web ? webLeftGlow : styles.nativeLeftGlow,
          leftAnimation,
        ]}
      >
        {web ? null : <NativeGlowLayers color="rgba(69, 122, 230, 0.055)" />}
      </Animated.View>
      <Animated.View
        style={[
          styles.glow,
          {
            height: width * 0.42,
            right: -width * 0.08,
            top: -width * 0.22,
            width: width * 0.56,
          },
          web ? webTopGlow : styles.nativeTopGlow,
          topAnimation,
        ]}
      >
        {web ? null : <NativeGlowLayers color="rgba(111, 160, 235, 0.05)" />}
      </Animated.View>
      <Animated.View
        style={[
          styles.glow,
          {
            height: width * 0.34,
            left: width * 0.32,
            top: height * 0.28,
            width: width * 0.48,
          },
          web ? webCenterGlow : styles.nativeCenterGlow,
          centerAnimation,
        ]}
      >
        {web ? null : <NativeGlowLayers color="rgba(151, 184, 235, 0.045)" />}
      </Animated.View>
      {web ? null : <NativeGrid height={height} width={width} />}
    </View>
  );
}

function NativeGlowLayers({ color }: { color: string }) {
  return (
    <>
      <View style={[styles.nativeGlowLayer, styles.nativeGlowOuter, { backgroundColor: color }]} />
      <View style={[styles.nativeGlowLayer, styles.nativeGlowMiddle, { backgroundColor: color }]} />
      <View style={[styles.nativeGlowLayer, styles.nativeGlowCore, { backgroundColor: color }]} />
    </>
  );
}

function NativeGrid({ height, width }: { height: number; width: number }) {
  const verticalLines = Array.from({ length: Math.ceil(width / GRID_SIZE) }, (_, index) => index);
  const horizontalLines = Array.from(
    { length: Math.ceil(height / GRID_SIZE) },
    (_, index) => index,
  );

  return (
    <View style={StyleSheet.absoluteFill}>
      {verticalLines.map((index) => (
        <View
          key={`vertical-${index}`}
          style={[styles.gridLine, styles.verticalGridLine, { left: index * GRID_SIZE }]}
        />
      ))}
      {horizontalLines.map((index) => {
        const y = index * GRID_SIZE;
        const progress = y / height;
        const opacity = progress < 0.45 ? 0.75 : Math.max(0, (0.55 * (0.88 - progress)) / 0.43);
        return (
          <View
            key={`horizontal-${index}`}
            style={[styles.gridLine, styles.horizontalGridLine, { opacity, top: y }]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  // 单个路由的光晕不得溢出到全局侧栏与顶栏，避免层级嵌套时重复叠色。
  backgroundLayer: { overflow: 'hidden', zIndex: 0 },
  nativeBackground: { backgroundColor: colors.background },
  glow: {
    alignItems: 'center',
    borderRadius: 9999,
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'absolute',
  },
  nativeLeftGlow: { backgroundColor: 'rgba(69, 122, 230, 0.008)' },
  nativeTopGlow: { backgroundColor: 'rgba(111, 160, 235, 0.008)' },
  nativeCenterGlow: { backgroundColor: 'rgba(151, 184, 235, 0.008)' },
  nativeGlowLayer: { borderRadius: 9999, position: 'absolute' },
  nativeGlowOuter: { height: '100%', opacity: 0.24, width: '100%' },
  nativeGlowMiddle: { height: '72%', opacity: 0.42, width: '72%' },
  nativeGlowCore: { height: '42%', opacity: 0.65, width: '42%' },
  gridLine: { backgroundColor: 'rgba(70, 105, 165, 0.065)', position: 'absolute' },
  verticalGridLine: { bottom: 0, top: 0, width: StyleSheet.hairlineWidth },
  horizontalGridLine: { height: StyleSheet.hairlineWidth, left: 0, right: 0, width: undefined },
});

const webAmbientBackground = {
  backgroundColor: colors.background,
  backgroundImage: [
    'linear-gradient(rgba(70, 105, 165, 0.07) 1px, transparent 1px)',
    'linear-gradient(90deg, rgba(70, 105, 165, 0.07) 1px, transparent 1px)',
    'radial-gradient(ellipse 70vw 70vw at 0% 34%, rgba(74, 129, 230, 0.18) 0%, rgba(97, 148, 235, 0.09) 38%, transparent 72%)',
    'radial-gradient(ellipse 56vw 42vw at 96% -20%, rgba(104, 151, 224, 0.2) 0%, rgba(126, 167, 229, 0.09) 48%, transparent 72%)',
    'radial-gradient(ellipse 48vw 34vw at 56% 32%, rgba(124, 170, 237, 0.12) 0%, rgba(150, 186, 238, 0.05) 55%, transparent 76%)',
    'linear-gradient(180deg, #F8FAFF 0%, #F4F7FC 48%, #FAFBFE 100%)',
  ].join(', '),
  backgroundPosition: 'center top',
  backgroundRepeat: 'repeat, repeat, no-repeat, no-repeat, no-repeat, no-repeat',
  backgroundSize: '96px 96px, 96px 96px, 100% 100%, 100% 100%, 100% 100%, 100% 100%',
} as unknown as ViewStyle;

const webLeftGlow = {
  backgroundImage:
    'radial-gradient(circle, rgba(74, 129, 230, 0.28) 0%, rgba(97, 148, 235, 0.16) 35%, rgba(128, 168, 235, 0.06) 60%, transparent 75%)',
} as unknown as ViewStyle;

const webTopGlow = {
  backgroundImage:
    'radial-gradient(ellipse, rgba(104, 151, 224, 0.24) 0%, rgba(126, 167, 229, 0.12) 48%, transparent 72%)',
} as unknown as ViewStyle;

const webCenterGlow = {
  backgroundImage:
    'radial-gradient(ellipse, rgba(124, 170, 237, 0.16) 0%, rgba(150, 186, 238, 0.07) 55%, transparent 76%)',
} as unknown as ViewStyle;
