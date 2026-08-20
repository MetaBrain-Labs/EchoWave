/**
 * 知识问答动态进度卡片。
 *
 * 在最终可信 JSON 返回前提供客户端等待反馈；阶段是展示节奏，不冒充服务端实时遥测。
 *
 * Responsibilities:
 * - 依次呈现唤醒、连接、检索和生成阶段。
 * - 在最终响应到达后展示可证实的引用来源数量。
 * - 尊重系统减少动态效果设置并清理动画与计时器。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors, fontFamilies, radii, spacing, textColors, typography } from '@/shared/theme/tokens';

const stages = ['唤醒 AI', '连接知识库', '检索知识库', '生成结果中'] as const;
const stageDelays = [350, 900, 1_600] as const;

/** 渲染一轮等待中或已验证的 Assistant 进度。 */
export function AnswerProgressCard({
  onProgressChange,
  sourceCount,
}: {
  onProgressChange?: () => void;
  sourceCount?: number;
}) {
  const [activeStage, setActiveStage] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [pulse] = useState(() => new Animated.Value(0));
  const verified = sourceCount !== undefined;

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) setReduceMotion(value);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (verified) {
      onProgressChange?.();
      return undefined;
    }
    const timers = stageDelays.map((delay, index) => setTimeout(() => {
      setActiveStage(index + 1);
      onProgressChange?.();
    }, delay));
    return () => timers.forEach(clearTimeout);
  }, [onProgressChange, verified]);

  useEffect(() => {
    if (reduceMotion) {
      pulse.setValue(0);
      return undefined;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          duration: 520,
          easing: Easing.inOut(Easing.ease),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          duration: 520,
          easing: Easing.inOut(Easing.ease),
          toValue: 0,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulse, reduceMotion]);

  const finalLabel = sourceCount === 0
    ? '未找到可引用依据'
    : `已确认 ${sourceCount} 条引用来源`;
  const displayedStage = verified ? stages.length : activeStage;

  return (
    <View
      accessibilityLabel={verified ? finalLabel : stages[displayedStage]}
      accessibilityLiveRegion="polite"
      accessibilityRole="progressbar"
      style={styles.card}
      testID="knowledge-answer-progress"
    >
      <View style={styles.headingRow}>
        <Animated.View
          style={reduceMotion ? undefined : {
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }),
            transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.08] }) }],
          }}
        >
          <Ionicons color={colors.success} name="sparkles" size={22} />
        </Animated.View>
        <Text style={styles.heading}>Assistant 正在处理</Text>
      </View>
      <View style={styles.steps}>
        {stages.map((stage, index) => {
          const complete = index < displayedStage;
          const current = !verified && index === displayedStage;
          return (
            <View key={stage} style={styles.stepRow}>
              <View style={[styles.marker, complete && styles.completeMarker, current && styles.currentMarker]}>
                {complete ? <Ionicons color={colors.card} name="checkmark" size={12} /> : null}
              </View>
              <Text style={[styles.stepText, (complete || current) && styles.activeStepText]}>{stage}</Text>
              {current ? <Text style={styles.dots}>•••</Text> : null}
            </View>
          );
        })}
        {verified ? (
          <View style={styles.verifiedRow}>
            <Ionicons color={sourceCount === 0 ? colors.muted : colors.success} name={sourceCount === 0 ? 'information-circle-outline' : 'checkmark-circle'} size={18} />
            <Text style={styles.verifiedText}>{finalLabel}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'flex-start',
    backgroundColor: colors.background,
    borderColor: colors.divider,
    borderRadius: radii.default,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.md,
    maxWidth: '92%',
    padding: spacing.md,
  },
  headingRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  heading: { ...typography.heading5, color: textColors.primary, fontFamily: fontFamilies.sansBold, fontWeight: 'bold' },
  steps: { gap: spacing.sm },
  stepRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, minHeight: 22 },
  marker: { borderColor: colors.divider, borderRadius: radii.round, borderWidth: 1, height: 18, width: 18 },
  completeMarker: { alignItems: 'center', backgroundColor: colors.success, borderColor: colors.success, justifyContent: 'center' },
  currentMarker: { backgroundColor: colors.successSurface, borderColor: colors.success },
  stepText: { ...typography.description, color: textColors.tertiary, fontFamily: fontFamilies.sans },
  activeStepText: { color: textColors.primary },
  dots: { ...typography.label, color: colors.success, fontFamily: fontFamilies.sansBold, letterSpacing: 2 },
  verifiedRow: { alignItems: 'center', borderTopColor: colors.divider, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: spacing.sm, paddingTop: spacing.sm },
  verifiedText: { ...typography.description, color: textColors.secondary, fontFamily: fontFamilies.sansBold, fontWeight: 'bold' },
});
