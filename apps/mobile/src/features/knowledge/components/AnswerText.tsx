/**
 * 可信回答正文。
 *
 * 渲染答案文本，并把落在引用清单范围内的 [n] 标记变成可点击片段，
 * 供用户点击后跳转到下方对应的引用卡片。
 *
 * Responsibilities:
 * - 按引用数量拆解正文中的引用标记。
 * - 为标记提供可访问名称与跳转回调。
 *
 * Notes:
 * - 只负责正文与标记展示；滚动、展开与高亮由引用列表和页面负责。
 */
import { Text, type StyleProp, type TextStyle } from 'react-native';

import { useAppLanguage } from '@/shared/i18n/LanguageProvider';
import { colors, fontFamilies } from '@/shared/theme/tokens';

import { splitAnswerCitations } from './citationDisplay';

/** 渲染带可点击引用标记的答案正文。 */
export function AnswerText({
  answer,
  citationCount,
  onOpenCitationMarker,
  style,
}: {
  answer: string;
  citationCount: number;
  onOpenCitationMarker: (number: number) => void;
  style?: StyleProp<TextStyle>;
}) {
  const { formatNumber, t } = useAppLanguage();
  const segments = splitAnswerCitations(answer, citationCount);

  return (
    <Text selectable style={style}>
      {segments.map((segment) =>
        segment.kind === 'text' ? (
          segment.text
        ) : (
          <Text
            accessibilityHint={t('citation.markerHint')}
            accessibilityLabel={t('citation.marker', { number: formatNumber(segment.number) })}
            accessibilityRole="link"
            key={segment.key}
            onPress={() => onOpenCitationMarker(segment.number)}
            style={styles.marker}
          >
            {`[${formatNumber(segment.number)}]`}
          </Text>
        ),
      )}
    </Text>
  );
}

const styles = {
  marker: {
    color: colors.primary,
    fontFamily: fontFamilies.sansBold,
    fontWeight: 'bold',
  },
} as const;
