/**
 * 功能说明卡片测试。
 *
 * 验证卡片渲染标题与全部要点，并且每个受支持的命名空间都有中英双语文案。
 *
 * Notes:
 * - 文案完整性在此锁定，避免新增命名空间时缺少翻译而渲染出键名。
 */
import { render } from '@testing-library/react-native';

import { GUIDE_HINT_NAMESPACES, guideHintPointKeys } from '@/shared/onboarding/guideHintCopy';
import { en, zhCN } from '@/shared/i18n/translations';
import { GuideHintCard } from '../GuideHintCard';

describe('GuideHintCard', () => {
  it('renders the title and every supported point', () => {
    const screen = render(<GuideHintCard namespace="guideHint.createHub" />);

    expect(screen.getByText('新建：选择创建方式')).toBeTruthy();
    for (const key of guideHintPointKeys('guideHint.createHub')) {
      expect(screen.getByText(`• ${zhCN[key]}`)).toBeTruthy();
    }
    expect(screen.getByTestId('guide-hint-guideHint.createHub')).toBeTruthy();
  });

  it.each(GUIDE_HINT_NAMESPACES)('has Chinese and English copy for %s', (namespace) => {
    for (const catalog of [zhCN, en]) {
      expect(catalog[`${namespace}.title` as keyof typeof zhCN]).toBeTruthy();
      for (const key of guideHintPointKeys(namespace)) {
        expect(catalog[key]).toBeTruthy();
      }
    }
  });
});
