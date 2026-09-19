/**
 * 功能页顶部栏引导 / 提示按钮。
 *
 * 让主功能页在顶部栏直接提供该功能的引导或说明，无需先回到“新手引导中心”。
 *
 * Responsibilities:
 * - 已有引导的功能：点击启动该引导，并在结束后回到来源页。
 * - 尚无引导的功能：点击请求宿主切换本页说明卡片。
 *
 * Notes:
 * - 只在存在引导编排 Provider 时才有行为；未包裹 Provider 的环境沿用无副作用默认值。
 * - 说明卡片由宿主渲染在页面正文，避免塞进 flex 行布局的页头。
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet } from 'react-native';

import type { GuideHintNamespace } from '@/shared/onboarding/guideHintCopy';
import type { GuideId } from '@/shared/onboarding/guideRegistry';
import { useStarterTour } from '@/shared/onboarding/StarterTourContext';
import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import { colors } from '@/shared/theme/tokens';

/** 引导型内容：启动指定引导。 */
export type GuideTourContent = {
  guide: GuideId;
  kind: 'tour';
  /** 功能页自身路由；引导完成或跳过后回到这里。 */
  returnTo?: string;
};

/** 提示型内容：请求宿主切换该功能的说明卡片。 */
export type GuideHintContent = {
  kind: 'hint';
  namespace: GuideHintNamespace;
};

export type GuideButtonProps = {
  content: GuideTourContent | GuideHintContent;
  /** 提示型内容为展开状态，用于无障碍播报。 */
  expanded?: boolean;
  /** 提示型内容点击时通知宿主切换说明卡片。 */
  onToggleHint?: () => void;
  /** 页头操作需要 testID 时透传。 */
  testID?: string;
};

/** 渲染顶部栏引导按钮。 */
export function GuideButton({ content, expanded, onToggleHint, testID }: GuideButtonProps) {
  const { t } = useAppLanguage();
  const { startGuide } = useStarterTour();

  return (
    <Pressable
      accessibilityLabel={
        content.kind === 'tour' ? t('guideHelp.openTour') : t('guideHelp.openHint')
      }
      accessibilityRole="button"
      accessibilityState={content.kind === 'hint' ? { expanded: Boolean(expanded) } : undefined}
      hitSlop={8}
      onPress={() => {
        if (content.kind === 'tour') {
          startGuide(content.guide, content.returnTo);
          return;
        }
        onToggleHint?.();
      }}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      testID={testID}
    >
      <Ionicons color={colors.ink} name="help-circle-outline" size={30} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  pressed: { backgroundColor: colors.background },
});
