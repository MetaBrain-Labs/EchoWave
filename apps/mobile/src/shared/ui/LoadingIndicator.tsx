/**
 * EchoWave 跨平台品牌加载指示器。
 *
 * 使用固定 SVG 关键帧在原生端和 Web 统一呈现短任务与长任务的等待状态。
 *
 * Responsibilities:
 * - 管理页面指示器的延迟显示、系统减少动态效果和前后台动画状态。
 * - 向旧 ActivityIndicator 调用方保留熟悉的尺寸与颜色接口。
 *
 * Notes:
 * - 动画进度在 UI 线程运行；语言镜像提供双语无障碍说明，不依赖其他 Provider。
 */
import {
  AccessibilityInfo,
  AppState,
  StyleSheet,
  View,
  type AccessibilityRole,
  type ColorValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useEffect, useState, type ReactNode } from 'react';

import { useAppLanguage } from '@/shared/i18n/LanguageProvider';

import { LongLoadingAsset, ShortLoadingAsset } from './loading-assets/LoadingAssets';

export type LoadingDuration = 'short' | 'long';

/** 描述应用加载指示器的尺寸、状态和可访问语义。 */
export type LoadingIndicatorProps = {
  accessibilityLabel?: string;
  accessibilityRole?: AccessibilityRole;
  animating?: boolean;
  color?: ColorValue;
  delayMs?: number;
  duration?: LoadingDuration;
  hideWhenStopped?: boolean;
  size?: number | 'large' | 'small';
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** 渲染导航加载、页面占位、按钮和局部任务使用的品牌动画。 */
export function LoadingIndicator({
  accessibilityLabel,
  accessibilityRole = 'progressbar',
  animating = true,
  delayMs = 150,
  duration = 'short',
  hideWhenStopped = false,
  size = 48,
  style,
  testID,
}: LoadingIndicatorProps) {
  const { t } = useAppLanguage();
  const resolvedAccessibilityLabel = accessibilityLabel ?? t('common.loading');
  const boxSize = typeof size === 'number' ? Math.max(24, size) : size === 'large' ? 64 : 32;
  const delayDuration = Math.max(0, delayMs);
  if (!animating && hideWhenStopped) return null;

  return (
    <View
      accessible={!hideWhenStopped && animating}
      accessibilityElementsHidden={!animating}
      accessibilityLabel={!hideWhenStopped && animating ? resolvedAccessibilityLabel : undefined}
      accessibilityLiveRegion="polite"
      accessibilityRole={accessibilityRole}
      accessibilityState={{ busy: animating }}
      collapsable={false}
      importantForAccessibility={
        !animating ? 'no-hide-descendants' : hideWhenStopped ? 'auto' : 'yes'
      }
      style={[styles.root, { height: boxSize, width: boxSize }, style]}
      testID={testID}
    >
      {animating ? (
        <LoadingAnimationSession
          key={`${delayDuration}:${duration}`}
          accessibilityLabel={resolvedAccessibilityLabel}
          accessibilityRole={accessibilityRole}
          accessible={hideWhenStopped}
          delayMs={delayDuration}
          duration={duration}
        />
      ) : null}
    </View>
  );
}

/** 在每个真实请求会话内延迟挂载路径并负责动画与系统状态订阅。 */
function LoadingAnimationSession({
  accessibilityLabel,
  accessibilityRole,
  accessible,
  delayMs,
  duration,
}: {
  accessibilityLabel: string;
  accessibilityRole: AccessibilityRole;
  accessible: boolean;
  delayMs: number;
  duration: LoadingDuration;
}) {
  const progress = useSharedValue(0);
  const [ready, setReady] = useState(delayMs === 0);
  const [reducedMotion, setReducedMotion] = useState<boolean | null>(null);
  const [appActive, setAppActive] = useState(
    AppState.currentState !== 'inactive' && AppState.currentState !== 'background',
  );
  const animationDuration = duration === 'long' ? 1_280 : 1_383;

  useEffect(() => {
    let mounted = true;
    void Promise.resolve(AccessibilityInfo.isReduceMotionEnabled?.())
      .then((enabled) => {
        if (mounted) setReducedMotion(enabled === true);
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener?.(
      'reduceMotionChanged',
      setReducedMotion,
    );
    return () => {
      mounted = false;
      subscription?.remove();
    };
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener?.('change', (state) => {
      setAppActive(state === 'active');
    });
    return () => subscription?.remove();
  }, []);

  useEffect(() => {
    if (delayMs === 0) return undefined;
    const timer = setTimeout(() => setReady(true), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs]);

  useEffect(() => {
    // 偏好读取完成前保持静态，避免用户启用减少动态效果时先闪过循环动画。
    if (!ready || reducedMotion !== false || !appActive) {
      cancelAnimation(progress);
      progress.value = 0;
      return undefined;
    }

    progress.value = withRepeat(
      withTiming(1, { duration: animationDuration, easing: Easing.linear }),
      -1,
      false,
    );
    return () => cancelAnimation(progress);
  }, [appActive, animationDuration, progress, ready, reducedMotion]);

  if (!ready || (!appActive && !reducedMotion)) return null;

  return (
    <View
      accessible={accessible}
      accessibilityLabel={accessible ? accessibilityLabel : undefined}
      accessibilityElementsHidden={!accessible}
      accessibilityLiveRegion="polite"
      accessibilityRole={accessibilityRole}
      accessibilityState={{ busy: true }}
      importantForAccessibility={accessible ? 'yes' : 'no-hide-descendants'}
      style={styles.session}
    >
      <Animated.View
        style={styles.asset}
        testID={duration === 'long' ? 'loading-asset-long' : 'loading-asset-short'}
      >
        {duration === 'long' ? (
          <LongLoadingAsset progress={progress} />
        ) : (
          <ShortLoadingAsset progress={progress} />
        )}
      </Animated.View>
    </View>
  );
}

/** 在页面或表单中将加载指示器与现有阶段、错误或重试文案排在一起。 */
export function LoadingMessage({
  accessibilityLabel,
  children,
  duration = 'short',
  style,
  testID,
}: {
  accessibilityLabel?: string;
  children: ReactNode;
  duration?: LoadingDuration;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return (
    <View accessibilityLabel={accessibilityLabel} style={[styles.message, style]} testID={testID}>
      <LoadingIndicator accessibilityLabel={accessibilityLabel} duration={duration} size={48} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', justifyContent: 'center', overflow: 'visible' },
  session: { alignItems: 'center', height: '100%', justifyContent: 'center', width: '100%' },
  asset: { height: '100%', width: '100%' },
  message: { alignItems: 'center', justifyContent: 'center', gap: 12 },
});
